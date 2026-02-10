import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root (one level up from server/)
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Environment
const IS_PROD = process.env.NODE_ENV === 'production';
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || ['*'];

// No external API keys needed for spots - uses free OpenStreetMap

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: IS_PROD ? ALLOWED_ORIGINS : "*",
    methods: ["GET", "POST"]
  }
});

// CORS - tightened for production
app.use(cors({
  origin: IS_PROD ? ALLOWED_ORIGINS : '*'
}));
app.use(express.json());

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window per IP
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const createSessionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 sessions per hour per IP
  message: { error: 'Too many sessions created, please try again later.' }
});

app.use('/api/', apiLimiter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Sanitize input to prevent XSS
function sanitize(str, maxLen = 50) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .trim()
    .slice(0, maxLen);
}

// SQLite setup
const db = new Database(path.join(__dirname, 'vibe.db'));

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    mode TEXT DEFAULT 'discover',
    category TEXT NOT NULL,
    location TEXT,
    location_radius TEXT,
    status TEXT DEFAULT 'lobby',
    host_name TEXT,
    questions TEXT,
    places TEXT,
    results TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS participants (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    name TEXT NOT NULL,
    answers TEXT,
    completed INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );

  CREATE INDEX IF NOT EXISTS idx_session ON participants(session_id);
`);

// Safe migration for existing databases
try { db.exec(`ALTER TABLE sessions ADD COLUMN mode TEXT DEFAULT 'discover'`); } catch(e) {}
try { db.exec(`ALTER TABLE sessions ADD COLUMN places TEXT`); } catch(e) {}

// Session cleanup - delete sessions older than 24 hours
function cleanupOldSessions() {
  const cutoff = Math.floor(Date.now() / 1000) - (24 * 60 * 60); // 24 hours ago
  try {
    const deleted = db.prepare('DELETE FROM participants WHERE session_id IN (SELECT id FROM sessions WHERE created_at < ?)').run(cutoff);
    const deletedSessions = db.prepare('DELETE FROM sessions WHERE created_at < ?').run(cutoff);
    if (deletedSessions.changes > 0) {
      console.log(`Cleaned up ${deletedSessions.changes} old sessions`);
    }
  } catch (err) {
    console.error('Session cleanup failed:', err);
  }
}

// Run cleanup on startup and every hour
cleanupOldSessions();
setInterval(cleanupOldSessions, 60 * 60 * 1000);

// AI Configuration
const AI_MODEL = process.env.AI_MODEL || 'hf:moonshotai/Kimi-K2-Instruct-0905';
const SYNTHETIC_API = 'https://api.synthetic.new/v1/chat/completions';

// OpenStreetMap Overpass API for verified places (free, no key needed)
const OVERPASS_API = 'https://overpass-api.de/api/interpreter';

// Geocode a location string to lat/lon using Photon
async function geocodeLocation(locationStr) {
  try {
    const res = await fetch(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(locationStr)}&limit=1`,
      { headers: { 'User-Agent': 'VibeChecker/1.0' } }
    );
    const data = await res.json();
    const coords = data.features?.[0]?.geometry?.coordinates;
    if (coords) {
      return { lat: coords[1], lon: coords[0] };
    }
    return null;
  } catch (err) {
    console.error('Geocoding failed:', err);
    return null;
  }
}

// Search for real places using OpenStreetMap Overpass API
async function searchPlaces(query, location, radiusMeters = 5000) {
  try {
    // First geocode the location
    const coords = await geocodeLocation(location);
    if (!coords) {
      console.error('Could not geocode location:', location);
      return [];
    }

    console.log(`Searching Overpass for "${query}" near ${coords.lat},${coords.lon} within ${radiusMeters}m`);

    // Map common food/drink queries to OSM tags
    const cuisineKeywords = query.toLowerCase();
    let tagFilter;

    // Try to match cuisine type for better results
    if (cuisineKeywords.includes('bar') || cuisineKeywords.includes('cocktail') || cuisineKeywords.includes('pub')) {
      tagFilter = `["amenity"="bar"]`;
    } else if (cuisineKeywords.includes('coffee') || cuisineKeywords.includes('cafe') || cuisineKeywords.includes('café')) {
      tagFilter = `["amenity"="cafe"]`;
    } else if (cuisineKeywords.includes('pizza')) {
      tagFilter = `["amenity"="restaurant"]["cuisine"~"pizza",i]`;
    } else if (cuisineKeywords.includes('taco') || cuisineKeywords.includes('mexican')) {
      tagFilter = `["amenity"="restaurant"]["cuisine"~"mexican|tex-mex",i]`;
    } else if (cuisineKeywords.includes('sushi') || cuisineKeywords.includes('japanese')) {
      tagFilter = `["amenity"="restaurant"]["cuisine"~"japanese|sushi",i]`;
    } else if (cuisineKeywords.includes('thai')) {
      tagFilter = `["amenity"="restaurant"]["cuisine"~"thai",i]`;
    } else if (cuisineKeywords.includes('indian')) {
      tagFilter = `["amenity"="restaurant"]["cuisine"~"indian",i]`;
    } else if (cuisineKeywords.includes('chinese')) {
      tagFilter = `["amenity"="restaurant"]["cuisine"~"chinese",i]`;
    } else if (cuisineKeywords.includes('bbq') || cuisineKeywords.includes('barbecue')) {
      tagFilter = `["amenity"="restaurant"]["cuisine"~"bbq|barbecue",i]`;
    } else if (cuisineKeywords.includes('burger')) {
      tagFilter = `["amenity"~"restaurant|fast_food"]["cuisine"~"burger",i]`;
    } else if (cuisineKeywords.includes('ice cream') || cuisineKeywords.includes('dessert')) {
      tagFilter = `["amenity"~"cafe|ice_cream"]["cuisine"~"ice_cream|dessert",i]`;
    } else if (cuisineKeywords.includes('brewery') || cuisineKeywords.includes('beer')) {
      tagFilter = `["amenity"~"bar|pub"]["microbrewery"="yes"]`;
      // Fallback: also search craft_brewery
    } else {
      // Generic restaurant search - search by name
      tagFilter = `["amenity"~"restaurant|bar|cafe"]["name"~"${query.replace(/"/g, '')}",i]`;
    }

    const overpassQuery = `[out:json][timeout:10];(node${tagFilter}(around:${radiusMeters},${coords.lat},${coords.lon});way${tagFilter}(around:${radiusMeters},${coords.lat},${coords.lon}););out center 10;`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(OVERPASS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(overpassQuery)}`,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error('Overpass API error:', response.status);
      return [];
    }

    const data = await response.json();
    const elements = data.elements || [];

    // Convert OSM data to our place format, filtering out places without names
    return elements
      .filter(el => el.tags?.name)
      .map(el => ({
        name: el.tags.name,
        address: [
          el.tags['addr:housenumber'],
          el.tags['addr:street'],
          el.tags['addr:city']
        ].filter(Boolean).join(' ') || null,
        website: el.tags.website || el.tags['contact:website'] || null,
        tel: el.tags.phone || el.tags['contact:phone'] || null,
        hours: el.tags.opening_hours || null,
        cuisine: el.tags.cuisine || null,
        lat: el.lat || el.center?.lat,
        lon: el.lon || el.center?.lon,
        osm_id: el.id
      }));

  } catch (err) {
    if (err.name === 'AbortError') {
      console.error('Overpass search timed out');
    } else {
      console.error('Overpass search failed:', err);
    }
    return [];
  }
}

// Verify and enrich recommendations with real place data
async function verifyRecommendations(recommendations, location, radiusMeters) {
  if (!location) {
    return recommendations;
  }

  const verified = [];
  const usedNames = new Set(); // avoid duplicates

  for (const rec of recommendations) {
    // Search for this recommendation on OpenStreetMap
    const places = await searchPlaces(rec.item, location, radiusMeters);

    if (places && places.length > 0) {
      // Find first place we haven't already used
      const place = places.find(p => !usedNames.has(p.name)) || null;
      if (place) {
        usedNames.add(place.name);
        verified.push({
          ...rec,
          item: place.name,
          verified: true,
          address: place.address,
          website: place.website,
          tel: place.tel,
          hours: place.hours,
          cuisine: place.cuisine,
          maps_url: `https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}#map=18/${place.lat}/${place.lon}`
        });
        continue;
      }
    }
    // Couldn't verify - drop it silently instead of showing AI nonsense
    console.log(`Dropping unverified recommendation: "${rec.item}"`);
  }

  return verified;
}

// Fetch real local places from OpenStreetMap for locals mode
async function fetchLocalPlaces(category, location, radiusMeters) {
  const coords = await geocodeLocation(location);
  if (!coords) {
    console.error('Could not geocode location for locals mode:', location);
    return [];
  }

  const queryStrategies = {
    food: [
      `["amenity"="restaurant"]`,
      `["amenity"="fast_food"]["name"]`,
      `["amenity"="cafe"]["cuisine"]`
    ],
    drinks: [
      `["amenity"~"bar|pub|biergarten|nightclub"]`,
      `["bar"="yes"]["name"]`,
      `["cocktails"="yes"]["name"]`
    ],
    activities: [
      // Entertainment venues
      `["amenity"~"theatre|cinema|arts_centre|community_centre|events_venue"]`,
      `["leisure"~"bowling_alley|escape_game|amusement_arcade|miniature_golf|sports_centre|ice_rink"]`,
      // Cultural spots
      `["tourism"~"museum|gallery|zoo|aquarium|theme_park|attraction"]`,
      // Outdoors & recreation
      `["leisure"~"park|garden|nature_reserve"]["name"]`,
      // Nightlife & entertainment
      `["amenity"~"nightclub|casino|karaoke_box"]`,
      // Sports & games
      `["sport"~"climbing|bowling|billiards"]["name"]`,
      `["leisure"="sports_centre"]["name"]`
    ]
  };

  const filters = queryStrategies[category] || queryStrategies.food;
  const allPlaces = [];
  const seenIds = new Set();

  for (const tagFilter of filters) {
    const query = `[out:json][timeout:10];(node${tagFilter}(around:${radiusMeters},${coords.lat},${coords.lon});way${tagFilter}(around:${radiusMeters},${coords.lat},${coords.lon}););out center 50;`;

    try {
      console.log(`Locals mode: querying Overpass with filter ${tagFilter}`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(OVERPASS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error('Overpass error for locals query:', response.status);
        continue;
      }

      const data = await response.json();
      for (const el of (data.elements || [])) {
        if (!el.tags?.name || seenIds.has(el.id)) continue;
        seenIds.add(el.id);
        const lat = el.lat || el.center?.lat;
        const lon = el.lon || el.center?.lon;
        allPlaces.push({
          id: `osm_${el.id}`,
          name: el.tags.name,
          address: [el.tags['addr:housenumber'], el.tags['addr:street'], el.tags['addr:city']].filter(Boolean).join(' ') || null,
          website: el.tags.website || el.tags['contact:website'] || null,
          tel: el.tags.phone || el.tags['contact:phone'] || null,
          hours: el.tags.opening_hours || null,
          cuisine: el.tags.cuisine || null,
          amenity: el.tags.amenity || el.tags.leisure || el.tags.tourism || null,
          lat,
          lon,
          maps_url: lat && lon ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}` : null
        });
      }
    } catch (err) {
      console.error('Overpass query failed:', err.name === 'AbortError' ? 'timeout' : err.message);
    }

    // Rate-limit between Overpass queries
    await new Promise(r => setTimeout(r, 1000));
  }

  // Deduplicate chains: only keep one location per business name
  const seenNames = new Set();
  const dedupedPlaces = allPlaces.filter(p => {
    const normalized = p.name.toLowerCase().replace(/[''`]/g, '').replace(/\s+/g, ' ').trim();
    if (seenNames.has(normalized)) return false;
    seenNames.add(normalized);
    return true;
  });

  console.log(`Locals mode: deduped ${allPlaces.length} → ${dedupedPlaces.length} (removed ${allPlaces.length - dedupedPlaces.length} duplicate names)`);

  // Prefer places with richer data (cuisine, address), then shuffle within tiers
  const richPlaces = dedupedPlaces.filter(p => p.cuisine && p.address);
  const mediumPlaces = dedupedPlaces.filter(p => (p.cuisine || p.address) && !(p.cuisine && p.address));
  const leanPlaces = dedupedPlaces.filter(p => !p.cuisine && !p.address);

  const prioritized = [
    ...richPlaces.sort(() => Math.random() - 0.5),
    ...mediumPlaces.sort(() => Math.random() - 0.5),
    ...leanPlaces.sort(() => Math.random() - 0.5)
  ];

  const TARGET = 10;
  const result = prioritized.slice(0, Math.max(TARGET, Math.min(prioritized.length, 12)));
  console.log(`Locals mode: found ${allPlaces.length} places (${richPlaces.length} rich, ${mediumPlaces.length} medium, ${leanPlaces.length} lean), returning ${result.length}`);
  return result;
}

// Compute locals results from overlap (no AI needed)
function computeLocalsResults(places, participants) {
  const parsedParticipants = participants.map(p => ({
    name: p.name,
    answers: JSON.parse(p.answers || '{}')
  }));

  const placeMap = {};
  for (const place of places) {
    placeMap[place.id] = place;
  }

  // Score each place based on votes
  // 5 vote types: love, like, meh, unknown, nope
  const placeScores = places.map(place => {
    const votes = parsedParticipants.map(p => p.answers[place.id] || 'unknown');
    const loveCount = votes.filter(v => v === 'love').length;
    const likeCount = votes.filter(v => v === 'like').length;
    const mehCount = votes.filter(v => v === 'meh').length;
    const unknownCount = votes.filter(v => v === 'unknown').length;
    const nopeCount = votes.filter(v => v === 'nope').length;

    const positiveCount = loveCount + likeCount;
    const negativeCount = nopeCount;

    return {
      ...place,
      loveCount,
      likeCount,
      mehCount,
      unknownCount,
      nopeCount,
      allLove: loveCount === parsedParticipants.length,
      allPositive: positiveCount === parsedParticipants.length,
      noneNope: nopeCount === 0,
      score: (loveCount * 4) + (likeCount * 2) + (mehCount * 0) + (unknownCount * 0) - (nopeCount * 3),
      voteBreakdown: [
        loveCount > 0 ? `${loveCount} love` : '',
        likeCount > 0 ? `${likeCount} like` : '',
        mehCount > 0 ? `${mehCount} meh` : '',
        unknownCount > 0 ? `${unknownCount} haven't tried` : '',
        nopeCount > 0 ? `${nopeCount} nope` : ''
      ].filter(Boolean).join(', ')
    };
  });

  // Cuisine frequency from loved/liked places (used for boosting)
  const cuisineFrequency = {};
  for (const place of placeScores) {
    const positiveSignal = place.loveCount + place.likeCount;
    if (positiveSignal > 0 && place.cuisine) {
      for (const c of place.cuisine.split(';').map(c => c.trim().toLowerCase())) {
        cuisineFrequency[c] = (cuisineFrequency[c] || 0) + positiveSignal;
      }
    }
  }

  // Apply cuisine boosting to all scores
  for (const place of placeScores) {
    if (place.cuisine) {
      const bonus = place.cuisine.split(';')
        .map(c => c.trim().toLowerCase())
        .reduce((sum, c) => sum + (cuisineFrequency[c] || 0), 0);
      place.boostedScore = place.score + bonus;
    } else {
      place.boostedScore = place.score;
    }
  }

  // Shared favorites: everyone loves or likes (at least some love)
  const sharedFavorites = placeScores
    .filter(p => p.allPositive && p.loveCount > 0)
    .sort((a, b) => b.boostedScore - a.boostedScore);

  // Places to try: nobody noped, not already a shared favorite
  const placesToTry = placeScores
    .filter(p => p.noneNope && !p.allPositive)
    .sort((a, b) => b.boostedScore - a.boostedScore);

  // Best bets: top-scoring places that aren't already in the above lists
  // This ensures we ALWAYS have a recommendation even if nobody overlaps
  const usedIds = new Set([
    ...sharedFavorites.map(p => p.id),
    ...placesToTry.map(p => p.id)
  ]);
  const bestBets = placeScores
    .filter(p => !usedIds.has(p.id) && p.score > 0)
    .sort((a, b) => b.boostedScore - a.boostedScore)
    .slice(0, 5);

  // If we still have nothing, just pick the least-hated places
  const fallbackPicks = (sharedFavorites.length === 0 && placesToTry.length === 0 && bestBets.length === 0)
    ? placeScores
        .sort((a, b) => a.nopeCount - b.nopeCount || b.loveCount - a.loveCount || b.likeCount - a.likeCount)
        .slice(0, 3)
    : [];

  // Individual taste profiles
  const individualProfiles = parsedParticipants.map(p => {
    const loved = Object.entries(p.answers)
      .filter(([_, v]) => v === 'love')
      .map(([id]) => placeMap[id])
      .filter(Boolean);
    const liked = Object.entries(p.answers)
      .filter(([_, v]) => v === 'like')
      .map(([id]) => placeMap[id])
      .filter(Boolean);
    const wantToTry = Object.entries(p.answers)
      .filter(([_, v]) => v === 'unknown')
      .map(([id]) => placeMap[id])
      .filter(Boolean);

    const cuisineCounts = {};
    for (const place of [...loved, ...liked]) {
      if (place.cuisine) {
        for (const c of place.cuisine.split(';').map(c => c.trim().toLowerCase())) {
          cuisineCounts[c] = (cuisineCounts[c] || 0) + 1;
        }
      }
    }

    const topCuisines = Object.entries(cuisineCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([cuisine]) => cuisine);

    return {
      name: p.name,
      lovedPlaces: loved,
      likedPlaces: liked,
      wantToTryPlaces: wantToTry,
      topCuisines,
      totalLoved: loved.length,
      totalLiked: liked.length,
      totalTry: wantToTry.length
    };
  });

  // Group cuisine summary
  const topGroupCuisines = Object.entries(cuisineFrequency)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([c]) => c);

  let groupSummary;
  if (sharedFavorites.length > 0) {
    groupSummary = `your group has ${sharedFavorites.length} shared favorite${sharedFavorites.length > 1 ? 's' : ''}${topGroupCuisines.length > 0 ? ` and gravitates toward ${topGroupCuisines.join(', ')}` : ''}. ${placesToTry.length} more place${placesToTry.length !== 1 ? 's' : ''} to explore together.`;
  } else if (placesToTry.length > 0) {
    groupSummary = `no unanimous favorites, but ${placesToTry.length} place${placesToTry.length !== 1 ? 's' : ''} interest everyone.${topGroupCuisines.length > 0 ? ` the group leans toward ${topGroupCuisines.join(', ')}.` : ''}`;
  } else if (bestBets.length > 0) {
    groupSummary = `different tastes, but we found some best bets based on what the group liked most.${topGroupCuisines.length > 0 ? ` popular cuisines: ${topGroupCuisines.join(', ')}.` : ''}`;
  } else if (fallbackPicks.length > 0) {
    groupSummary = `wildly different taste - here are the least controversial picks.${topGroupCuisines.length > 0 ? ` the group leans toward ${topGroupCuisines.join(', ')}.` : ''}`;
  } else {
    groupSummary = `no overlap found. try expanding your search radius or picking a different category.`;
  }

  // Flag if we need AI help (truly no good options)
  const needsAiFallback = sharedFavorites.length === 0 &&
                          placesToTry.length === 0 &&
                          bestBets.length === 0 &&
                          fallbackPicks.every(p => p.nopeCount > p.loveCount + p.likeCount);

  return {
    mode: 'locals',
    group_summary: groupSummary,
    shared_favorites: sharedFavorites.slice(0, 10),
    places_to_try: placesToTry.slice(0, 10),
    best_bets: bestBets,
    fallback_picks: fallbackPicks,
    individual_profiles: individualProfiles,
    cuisine_overlap: topGroupCuisines,
    needs_ai_fallback: needsAiFallback
  };
}

// Generate AI suggestions for places when the group has no overlap
async function generateAiFallbackSuggestions(category, location, locationRadius, cuisinePreferences, participantTastes) {
  const radiusDescription = {
    'walkable': 'within walking distance',
    'nearby': 'within a short drive',
    'city': 'anywhere in the area'
  }[locationRadius] || 'nearby';

  const systemPrompt = `You are a local expert helping a group find places they might all enjoy.

The group couldn't agree on the specific places they were shown, but here's what we know about their tastes:
- Category: ${category}
- Location: ${location}
- Search radius: ${radiusDescription}
- Cuisine preferences they gravitated toward: ${cuisinePreferences.join(', ') || 'varied/no clear pattern'}
- Individual tastes: ${JSON.stringify(participantTastes)}

Based on this, suggest 3-5 TYPES of places (not specific business names) that might appeal to the whole group. Focus on finding middle ground - places that offer variety or fusion, or have something for everyone.

Return ONLY a JSON array like this:
[
  {"type": "description of type of place to search for", "reason": "why this might work for the group", "search_query": "a good search term for finding this on OSM"}
]`;

  const result = await callAI([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Suggest place types for this group in ${location}.` }
  ], 800);

  if (!result) return [];

  try {
    const jsonMatch = result.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return [];
  } catch (err) {
    console.error('Failed to parse AI fallback suggestions:', err);
    return [];
  }
}

// Helper function to call AI with timeout
async function callAI(messages, maxTokens = 1000) {
  const apiKey = process.env.SYNTHETIC_API_KEY;

  if (!apiKey) {
    console.error('SYNTHETIC_API_KEY environment variable is not set');
    return null;
  }

  try {
    console.log('Calling Synthetic API with model:', AI_MODEL);

    // Add timeout using AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout

    const response = await fetch(SYNTHETIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages,
        max_tokens: maxTokens,
        temperature: 0.7
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API error:', response.status, errorText);
      return null;
    }

    const data = await response.json();
    console.log('API response received');
    return data.choices?.[0]?.message?.content || null;
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error('AI call timed out after 60 seconds');
    } else {
      console.error('AI call failed:', err);
    }
    return null;
  }
}

// Generate quiz questions using AI
// Hardcoded question pairs - more reliable than AI-generated ones
const QUESTION_BANKS = {
  activities: [
    { id: 1, left: "board games", right: "video games", dimension: "analog vs digital" },
    { id: 2, left: "escape room", right: "karaoke", dimension: "puzzle vs performance" },
    { id: 3, left: "hiking", right: "museum", dimension: "outdoors vs indoors" },
    { id: 4, left: "bowling", right: "mini golf", dimension: "competitive style" },
    { id: 5, left: "trivia night", right: "comedy show", dimension: "participate vs watch" },
    { id: 6, left: "spa day", right: "amusement park", dimension: "relaxation vs thrill" },
    { id: 7, left: "cooking class", right: "painting class", dimension: "culinary vs artistic" },
    { id: 8, left: "arcade", right: "laser tag", dimension: "chill vs active" },
    { id: 9, left: "picnic in the park", right: "rooftop hangout", dimension: "nature vs urban" },
    { id: 10, left: "live music", right: "movie night", dimension: "concert vs cinema" },
    { id: 11, left: "axe throwing", right: "pottery class", dimension: "rowdy vs zen" },
    { id: 12, left: "sports bar", right: "jazz club", dimension: "casual vs sophisticated" }
  ],
  food: [
    { id: 1, left: "spicy", right: "mild", dimension: "heat tolerance" },
    { id: 2, left: "sweet", right: "savory", dimension: "flavor preference" },
    { id: 3, left: "comfort food", right: "adventurous eats", dimension: "familiar vs new" },
    { id: 4, left: "home cooking", right: "dining out", dimension: "setting" },
    { id: 5, left: "fast casual", right: "fine dining", dimension: "vibe" },
    { id: 6, left: "meat lover", right: "plant-forward", dimension: "protein preference" },
    { id: 7, left: "brunch", right: "late night eats", dimension: "time of day" },
    { id: 8, left: "street food", right: "sit-down restaurant", dimension: "formality" },
    { id: 9, left: "sharing plates", right: "own entree", dimension: "communal vs individual" },
    { id: 10, left: "local spots", right: "popular chains", dimension: "discovery vs reliability" },
    { id: 11, left: "big portions", right: "small and refined", dimension: "quantity vs quality" },
    { id: 12, left: "ethnic cuisine", right: "american classics", dimension: "culinary culture" }
  ],
  drinks: [
    { id: 1, left: "cocktails", right: "beer", dimension: "spirit preference" },
    { id: 2, left: "wine bar", right: "dive bar", dimension: "ambiance" },
    { id: 3, left: "rooftop", right: "speakeasy", dimension: "scene vs hidden" },
    { id: 4, left: "craft/artisanal", right: "classic/simple", dimension: "complexity" },
    { id: 5, left: "sweet drinks", right: "bitter/dry", dimension: "taste profile" },
    { id: 6, left: "live music venue", right: "quiet conversation", dimension: "noise level" },
    { id: 7, left: "sports bar", right: "lounge", dimension: "energy" },
    { id: 8, left: "happy hour", right: "late night", dimension: "time of day" },
    { id: 9, left: "brewery/distillery", right: "cocktail bar", dimension: "drink focus" },
    { id: 10, left: "outdoor patio", right: "cozy interior", dimension: "setting" },
    { id: 11, left: "trying new spots", right: "regular haunts", dimension: "discovery vs comfort" },
    { id: 12, left: "bar snacks", right: "just drinks", dimension: "food pairing" }
  ]
};

function generateQuestions(category) {
  // Return hardcoded questions for the category, or a generic set
  const questions = QUESTION_BANKS[category];
  if (questions) {
    // Shuffle and return
    return [...questions].sort(() => Math.random() - 0.5);
  }

  // Fallback for unknown categories - use activities
  return [...QUESTION_BANKS.activities].sort(() => Math.random() - 0.5);
}

// Generate group synthesis and recommendations
async function generateResults(category, location, locationRadius, participants) {
  const participantData = participants.map(p => ({
    name: p.name,
    answers: JSON.parse(p.answers || '{}')
  }));

  // Radius in meters
  const radiusMeters = {
    'walkable': 1000,
    'nearby': 8000,
    'city': 25000
  }[locationRadius] || 8000;

  // For location-based categories (food, drinks, activities), fetch real places first
  const isLocationBased = location && ['food', 'drinks', 'activities'].includes(category);
  let availablePlaces = [];

  if (isLocationBased) {
    console.log(`Fetching real places for ${category} in ${location}...`);
    availablePlaces = await fetchLocalPlaces(category, location, radiusMeters);
    console.log(`Found ${availablePlaces.length} places`);
  }

  // Category-specific instructions
  const categoryInstructions = {
    activities: isLocationBased && availablePlaces.length > 0
      ? `Pick 4-5 places FROM THIS LIST that match the group's preferences. Include the exact name and a fun activity suggestion (e.g., "bowl a few rounds at Dart Bowl", "catch a show at the comedy club").`
      : 'Suggest specific activity types like "bowling alley", "escape room", "comedy club", "karaoke bar"',
    food: isLocationBased && availablePlaces.length > 0
      ? `Pick 4-5 restaurants FROM THIS LIST that match the group's preferences.`
      : 'Suggest specific cuisine types like "wood-fired pizza", "authentic tacos", "korean bbq"',
    drinks: isLocationBased && availablePlaces.length > 0
      ? `Pick 4-5 bars FROM THIS LIST that match the group's preferences.`
      : 'Suggest specific bar types like "craft cocktail bar", "beer garden", "dive bar"'
  };

  const placesContext = availablePlaces.length > 0
    ? `\n\nAVAILABLE PLACES (pick from these):\n${availablePlaces.slice(0, 30).map(p =>
        `- ${p.name}${p.amenity ? ` (${p.amenity})` : ''}${p.address ? ` - ${p.address}` : ''}`
      ).join('\n')}`
    : '';

  const systemPrompt = `You are helping a group decide what to do. Analyze their quiz answers and give recommendations.

Category: ${category}
${location ? `Location: ${location}` : ''}
Participants and answers: ${JSON.stringify(participantData)}
${placesContext}

${categoryInstructions[category] || 'Give specific recommendations'}

Output JSON:
{
  "group_summary": "1-2 sentences about the group's vibe",
  "recommendations": [
    {"item": "specific place or thing", "reason": "why it fits", "rank": 1}
  ],
  "individual_writeups": [
    {
      "name": "Person's name",
      "taste_summary": "Their vibe in one sentence",
      "most_similar_to": "Another participant or null",
      "personal_recs": ["rec 1", "rec 2"]
    }
  ]
}

Give 4-5 recommendations. For places, use the EXACT name from the list.`;

  const result = await callAI([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Analyze the quiz results and recommend ${category}.` }
  ], 2000);

  // Handle case where AI call failed (e.g., no API key)
  if (!result) {
    console.error('AI call returned null - check if SYNTHETIC_API_KEY is set');
    return {
      group_summary: 'Could not generate results. Please check server configuration.',
      recommendations: [],
      individual_writeups: participantData.map(p => ({
        name: p.name,
        taste_summary: 'Analysis unavailable',
        most_similar_to: null,
        personal_recs: []
      }))
    };
  }

  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);

      // Match recommendations to actual places for location-based categories
      if (isLocationBased && parsed.recommendations && availablePlaces.length > 0) {
        parsed.recommendations = parsed.recommendations.map(rec => {
          // Try to find matching place by name
          const placeName = rec.item.toLowerCase();
          const matchedPlace = availablePlaces.find(p =>
            placeName.includes(p.name.toLowerCase()) ||
            p.name.toLowerCase().includes(placeName.split(' at ').pop()?.trim() || '')
          );

          if (matchedPlace) {
            return {
              ...rec,
              name: matchedPlace.name,
              address: matchedPlace.address,
              website: matchedPlace.website,
              tel: matchedPlace.tel,
              hours: matchedPlace.hours,
              lat: matchedPlace.lat,
              lon: matchedPlace.lon,
              verified: true
            };
          }
          return rec;
        });
      }

      return parsed;
    }
    return { group_summary: 'Analysis pending', recommendations: [], individual_writeups: [] };
  } catch (err) {
    console.error('Failed to parse results:', err);
    return { group_summary: 'Analysis generated', recommendations: [], individual_writeups: [] };
  }
}

// API Routes

// Create session (rate limited to prevent abuse)
app.post('/api/session', createSessionLimiter, async (req, res) => {
  const { mode, category, locationRadius } = req.body;
  const hostName = sanitize(req.body.hostName, 50);
  const location = sanitize(req.body.location || '', 100);
  const sessionMode = mode || 'discover';

  if (!category || !hostName || hostName.length < 1) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (sessionMode === 'locals' && !location) {
    return res.status(400).json({ error: 'Location is required for locals mode' });
  }

  const id = nanoid(8);
  db.prepare(`
    INSERT INTO sessions (id, mode, category, location, location_radius, host_name, status)
    VALUES (?, ?, ?, ?, ?, ?, 'lobby')
  `).run(id, sessionMode, category, location || null, locationRadius || null, hostName);

  // Add host as participant
  const hostParticipantId = nanoid(8);
  db.prepare(`
    INSERT INTO participants (id, session_id, name, answers, completed)
    VALUES (?, ?, ?, '{}', 0)
  `).run(hostParticipantId, id, hostName);

  res.json({ id, link: `/session/${id}`, participantId: hostParticipantId });
});

// Get session status
app.get('/api/session/:id', (req, res) => {
  const { id } = req.params;
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const participants = db.prepare('SELECT id, name, completed FROM participants WHERE session_id = ?').all(id);
  const completedCount = participants.filter(p => p.completed).length;

  res.json({
    ...session,
    participants,
    completedCount,
    waitingCount: participants.length - completedCount
  });
});

// Generate questions for session
app.post('/api/session/:id/generate', async (req, res) => {
  const { id } = req.params;
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (session.mode === 'locals') {
    // Locals mode: fetch real places from OpenStreetMap
    const radiusMeters = { 'walkable': 1000, 'nearby': 8000, 'city': 25000 }[session.location_radius] || 5000;
    console.log(`Fetching local places for session ${id}, category: ${session.category}`);
    const places = await fetchLocalPlaces(session.category, session.location, radiusMeters);

    if (!places || places.length === 0) {
      return res.status(503).json({ error: 'Could not find places in this area. Try a larger radius.' });
    }

    db.prepare('UPDATE sessions SET places = ?, questions = ?, status = ? WHERE id = ?')
      .run(JSON.stringify(places), JSON.stringify(places), 'collecting', id);

    io.to(`session:${id}`).emit('questions_ready', { questions: places, mode: 'locals' });
    res.json({ questions: places, mode: 'locals' });
  } else {
    // Discover mode: use hardcoded question pairs
    console.log(`Getting questions for session ${id}, category: ${session.category}`);
    const questions = generateQuestions(session.category);

    if (!questions || questions.length === 0) {
      console.error('No questions available for category:', session.category);
      return res.status(500).json({ error: 'No questions available for this category.' });
    }

    db.prepare('UPDATE sessions SET questions = ?, status = ? WHERE id = ?').run(JSON.stringify(questions), 'collecting', id);

    io.to(`session:${id}`).emit('questions_ready', { questions });
    res.json({ questions });
  }
});

// Join session
app.post('/api/session/:id/join', (req, res) => {
  const { id } = req.params;
  const name = sanitize(req.body.name, 50);

  if (!name || name.length < 1) {
    return res.status(400).json({ error: 'Name required' });
  }

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const participantId = nanoid(8);
  db.prepare(`
    INSERT INTO participants (id, session_id, name, answers, completed)
    VALUES (?, ?, ?, '{}', 0)
  `).run(participantId, id, name);

  // Notify host of new participant
  io.to(`session:${id}`).emit('participant_joined', { name, id: participantId });

  res.json({ id: participantId, name, session });
});

// Submit quiz answers
app.post('/api/session/:id/submit', async (req, res) => {
  const { id } = req.params;
  const { participantId, answers } = req.body;

  const participant = db.prepare('SELECT * FROM participants WHERE id = ?').get(participantId);
  if (!participant) {
    return res.status(404).json({ error: 'Participant not found' });
  }

  db.prepare('UPDATE participants SET answers = ?, completed = 1 WHERE id = ?').run(JSON.stringify(answers), participantId);

  // Check if all participants completed
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  const participants = db.prepare('SELECT * FROM participants WHERE session_id = ?').all(id);
  const allCompleted = participants.every(p => p.completed);
  const allStarted = participants.length > 0;

  if (allStarted) {
    db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run(allCompleted ? 'complete' : 'collecting', id);
  }

  // Notify participants
  io.to(`session:${id}`).emit('answer_submitted', { participantName: participant.name });

  // Generate results if:
  // 1. All completed and session not yet complete, OR
  // 2. Session was already complete (late joiner submitted) - regenerate with new votes
  const shouldGenerateResults = allCompleted && session.status !== 'complete';
  const isLateJoinerUpdate = session.status === 'complete';

  if (shouldGenerateResults || isLateJoinerUpdate) {
    // For late joiner updates, only include completed participants
    const completedParticipants = isLateJoinerUpdate
      ? participants.filter(p => p.completed)
      : participants;

    let results;
    if (session.mode === 'locals') {
      const places = JSON.parse(session.places || '[]');
      results = computeLocalsResults(places, completedParticipants);

      // If no good options found, get AI suggestions for new place types to try
      if (results.needs_ai_fallback && session.location) {
        console.log('No overlap found, generating AI fallback suggestions...');
        const participantTastes = results.individual_profiles.map(p => ({
          name: p.name,
          cuisines: p.topCuisines,
          lovedCount: p.totalLoved,
          likedCount: p.totalLiked
        }));

        const aiSuggestions = await generateAiFallbackSuggestions(
          session.category,
          session.location,
          session.location_radius,
          results.cuisine_overlap,
          participantTastes
        );

        if (aiSuggestions.length > 0) {
          results.ai_suggestions = aiSuggestions;
          results.group_summary = `couldn't find common ground on the places shown. here are some fresh ideas based on your group's taste.`;
        }
      }
    } else {
      results = await generateResults(session.category, session.location, session.location_radius, completedParticipants);
    }

    // Mark if this was a late joiner update
    if (isLateJoinerUpdate) {
      results.updated_at = Date.now();
      results.update_reason = `${participant.name} joined and voted`;
    }

    db.prepare('UPDATE sessions SET results = ?, status = ? WHERE id = ?').run(JSON.stringify(results), 'complete', id);
    io.to(`session:${id}`).emit('results_ready', { results, isUpdate: isLateJoinerUpdate });
  }

  res.json({ success: true, allCompleted });
});

// Get results
app.get('/api/session/:id/results', (req, res) => {
  const { id } = req.params;
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const participants = db.prepare('SELECT name, answers, completed FROM participants WHERE session_id = ?').all(id);
  const results = session.results ? JSON.parse(session.results) : null;

  res.json({
    session,
    participants,
    results
  });
});

// Force close voting and generate results with completed participants only
app.post('/api/session/:id/close', async (req, res) => {
  const { id } = req.params;
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (session.status === 'complete') {
    return res.status(400).json({ error: 'Session already complete' });
  }

  // Get only completed participants
  const participants = db.prepare(
    'SELECT * FROM participants WHERE session_id = ? AND completed = 1'
  ).all(id);

  if (participants.length === 0) {
    return res.status(400).json({ error: 'No participants have completed the quiz yet' });
  }

  // Generate results with whoever has finished
  let results;
  if (session.mode === 'locals') {
    const places = JSON.parse(session.places || '[]');
    results = computeLocalsResults(places, participants);

    // If no good options found, get AI suggestions
    if (results.needs_ai_fallback && session.location) {
      console.log('No overlap found, generating AI fallback suggestions...');
      const participantTastes = results.individual_profiles.map(p => ({
        name: p.name,
        cuisines: p.topCuisines,
        lovedCount: p.totalLoved,
        likedCount: p.totalLiked
      }));

      const aiSuggestions = await generateAiFallbackSuggestions(
        session.category,
        session.location,
        session.location_radius,
        results.cuisine_overlap,
        participantTastes
      );

      if (aiSuggestions.length > 0) {
        results.ai_suggestions = aiSuggestions;
        results.group_summary = `couldn't find common ground on the places shown. here are some fresh ideas based on your group's taste.`;
      }
    }
  } else {
    results = await generateResults(session.category, session.location, session.location_radius, participants);
  }

  db.prepare('UPDATE sessions SET results = ?, status = ? WHERE id = ?').run(JSON.stringify(results), 'complete', id);
  io.to(`session:${id}`).emit('results_ready', { results });

  res.json({ success: true, results });
});

// Socket.io for real-time updates
io.on('connection', (socket) => {
  socket.on('join_session', (sessionId) => {
    socket.join(`session:${sessionId}`);
  });

  socket.on('leave_session', (sessionId) => {
    socket.leave(`session:${sessionId}`);
  });
});

// Serve static files
app.use(express.static(path.join(__dirname, '../client/dist')));

// Catch-all for SPA
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  }
});

const PORT = process.env.PORT || 3003;
httpServer.listen(PORT, () => {
  console.log(`Vibe Check Spots running on port ${PORT}`);
});