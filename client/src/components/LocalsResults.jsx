import React, { useState } from 'react';

// Format category names: "bubble_tea" -> "Bubble Tea", "coffee_shop" -> "Coffee Shop"
function formatCategory(str) {
  if (!str) return '';
  return str
    .split(/[_;]/) // Split on underscores and semicolons
    .map(part => part.trim())
    .filter(Boolean)
    .map(part =>
      part.split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ')
    )
    .join(', ');
}

function PlaceCard({ place, extra }) {
  return (
    <div className="result-card">
      <div className="flex justify-between items-start mb-2">
        <span className="text-vt-white font-medium">{place.name}</span>
        {extra && <span className="text-vt-gray text-xs">{extra}</span>}
      </div>

      {place.cuisine && (
        <div className="flex flex-wrap gap-1 mb-2">
          {place.cuisine.split(';').map((c, i) => (
            <span key={i} className="px-2 py-0.5 text-xs rounded-full border border-vt-darkgray text-vt-gray">
              {formatCategory(c.trim())}
            </span>
          ))}
        </div>
      )}

      {place.voteBreakdown && (
        <p className="text-vt-gray text-xs mb-2">{place.voteBreakdown}</p>
      )}

      <div className="mt-3 pt-3 border-t border-vt-darkgray">
        {place.address && (
          <p className="text-vt-light text-xs mb-1">{place.address}</p>
        )}
        {place.hours && (
          <p className="text-vt-gray text-xs mb-1">{place.hours}</p>
        )}
        <div className="flex flex-wrap gap-3 mt-2">
          {place.website && (
            <a href={place.website} target="_blank" rel="noopener noreferrer"
              className="text-xs text-vt-light hover:text-vt-white underline">
              website
            </a>
          )}
          {place.tel && (
            <a href={`tel:${place.tel}`}
              className="text-xs text-vt-light hover:text-vt-white underline">
              {place.tel}
            </a>
          )}
          {(place.lat && place.lon) && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}${place.address ? '+' + encodeURIComponent(place.address) : ''}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-vt-light hover:text-vt-white underline">
              open in maps
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function LocalsResults({ sessionData, results, participantName, onNewSession }) {
  const [activeTab, setActiveTab] = useState('group');

  if (!results) {
    return (
      <div className="min-h-screen bg-vt-black flex flex-col px-6 py-8">
        {/* Skeleton Header */}
        <div className="mb-6">
          <div className="skeleton skeleton-text w-24 mb-2"></div>
          <div className="skeleton skeleton-title"></div>
        </div>

        {/* Skeleton Tabs */}
        <div className="flex gap-2 mb-6">
          <div className="skeleton w-16 h-10"></div>
          <div className="skeleton w-16 h-10"></div>
          <div className="skeleton w-16 h-10"></div>
        </div>

        {/* Skeleton Summary */}
        <div className="mb-8">
          <div className="skeleton skeleton-text w-20 mb-3"></div>
          <div className="skeleton skeleton-text w-full"></div>
          <div className="skeleton skeleton-text w-3/4"></div>
        </div>

        {/* Skeleton Cards */}
        <div className="skeleton skeleton-text w-32 mb-3"></div>
        <div className="flex flex-col gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="skeleton-card">
              <div className="skeleton skeleton-title mb-3"></div>
              <div className="flex gap-2 mb-3">
                <div className="skeleton w-16 h-6 rounded-full"></div>
                <div className="skeleton w-16 h-6 rounded-full"></div>
              </div>
              <div className="skeleton skeleton-text w-full"></div>
              <div className="skeleton skeleton-text w-1/2"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const {
    group_summary,
    shared_favorites = [],
    places_to_try = [],
    best_bets = [],
    fallback_picks = [],
    individual_profiles = [],
    cuisine_overlap = [],
    ai_suggestions = [],
    update_reason
  } = results;

  const myProfile = individual_profiles.find(p => p.name === participantName);

  const handleShare = async () => {
    const topPicks = [...shared_favorites, ...places_to_try, ...best_bets].slice(0, 3);
    const pickNames = topPicks.map(p => p.name).join(', ');
    const shareText = `vibe check results: ${group_summary}\n\ntop picks: ${pickNames}\n\n${window.location.href}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'vibe check results',
          text: shareText,
          url: window.location.href
        });
      } catch (err) {
        if (err.name !== 'AbortError') {
          // Fallback to clipboard
          await navigator.clipboard.writeText(shareText);
          alert('copied to clipboard!');
        }
      }
    } else {
      await navigator.clipboard.writeText(shareText);
      alert('copied to clipboard!');
    }
  };

  return (
    <div className="min-h-screen bg-vt-black flex flex-col px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex justify-between items-start">
        <div>
          <span className="text-vt-gray text-xs uppercase tracking-wider">
            locals / {sessionData?.category}
          </span>
          <h1 className="text-xl text-vt-white mt-1">results</h1>
          {update_reason && (
            <p className="text-vt-gray text-xs mt-1">updated: {update_reason}</p>
          )}
        </div>
        <button
          onClick={handleShare}
          className="text-vt-gray text-sm hover:text-vt-white transition-colors"
        >
          share
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab('group')}
          className={`py-2 px-4 text-sm border transition-all ${
            activeTab === 'group'
              ? 'border-vt-white bg-vt-white text-vt-black'
              : 'border-vt-darkgray text-vt-gray hover:border-vt-light'
          }`}
        >
          group
        </button>
        <button
          onClick={() => setActiveTab('personal')}
          className={`py-2 px-4 text-sm border transition-all ${
            activeTab === 'personal'
              ? 'border-vt-white bg-vt-white text-vt-black'
              : 'border-vt-darkgray text-vt-gray hover:border-vt-light'
          }`}
        >
          yours
        </button>
        <button
          onClick={() => setActiveTab('map')}
          className={`py-2 px-4 text-sm border transition-all ${
            activeTab === 'map'
              ? 'border-vt-white bg-vt-white text-vt-black'
              : 'border-vt-darkgray text-vt-gray hover:border-vt-light'
          }`}
        >
          map
        </button>
      </div>

      {/* Group Results */}
      {activeTab === 'group' && (
        <div className="flex-1 flex flex-col animate-fade-in">
          {/* Group Summary */}
          <div className="mb-8">
            <h2 className="text-vt-white text-sm mb-3">group vibe</h2>
            <p className="text-vt-light leading-relaxed">{group_summary}</p>
          </div>

          {/* Cuisine tags */}
          {cuisine_overlap.length > 0 && (
            <div className="mb-8">
              <h2 className="text-vt-white text-sm mb-3">group taste</h2>
              <div className="flex flex-wrap gap-2">
                {cuisine_overlap.map((c, i) => (
                  <span key={i} className="px-3 py-1 text-sm border border-vt-darkgray text-vt-light rounded-full">
                    {formatCategory(c)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Shared Favorites */}
          {shared_favorites.length > 0 && (
            <>
              <h2 className="text-vt-white text-sm mb-3">shared favorites</h2>
              <div className="flex flex-col gap-4 mb-8">
                {shared_favorites.map((place, idx) => (
                  <PlaceCard key={place.id || idx} place={place} extra="everyone loves" />
                ))}
              </div>
            </>
          )}

          {/* Places to Try */}
          {places_to_try.length > 0 && (
            <>
              <h2 className="text-vt-white text-sm mb-3">places to try together</h2>
              <div className="flex flex-col gap-4 mb-8">
                {places_to_try.map((place, idx) => (
                  <PlaceCard key={place.id || idx} place={place} />
                ))}
              </div>
            </>
          )}

          {/* Best Bets - when no unanimous picks but some positive signal */}
          {best_bets.length > 0 && (
            <>
              <h2 className="text-vt-white text-sm mb-3">best bets</h2>
              <p className="text-vt-gray text-xs mb-3">highest rated across the group</p>
              <div className="flex flex-col gap-4 mb-8">
                {best_bets.map((place, idx) => (
                  <PlaceCard key={place.id || idx} place={place} />
                ))}
              </div>
            </>
          )}

          {/* Fallback - when nothing else matched */}
          {fallback_picks.length > 0 && (
            <>
              <h2 className="text-vt-white text-sm mb-3">least controversial</h2>
              <p className="text-vt-gray text-xs mb-3">wildly different taste, but these had the least pushback</p>
              <div className="flex flex-col gap-4 mb-8">
                {fallback_picks.map((place, idx) => (
                  <PlaceCard key={place.id || idx} place={place} />
                ))}
              </div>
            </>
          )}

          {/* AI Suggestions - when no overlap at all */}
          {ai_suggestions.length > 0 && (
            <>
              <h2 className="text-vt-white text-sm mb-3">try something new</h2>
              <p className="text-vt-gray text-xs mb-3">based on your group's taste, here are some ideas</p>
              <div className="flex flex-col gap-3 mb-8">
                {ai_suggestions.map((suggestion, idx) => (
                  <a
                    key={idx}
                    href={`https://www.google.com/maps/search/${encodeURIComponent(suggestion.search_query || suggestion.type)}+${encodeURIComponent(sessionData?.location || '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-4 border border-vt-darkgray hover:border-vt-light transition-colors"
                  >
                    <div className="text-vt-white text-sm mb-1">{suggestion.type}</div>
                    <p className="text-vt-gray text-xs">{suggestion.reason}</p>
                    <span className="text-vt-light text-xs mt-2 inline-block underline">search on maps</span>
                  </a>
                ))}
              </div>
            </>
          )}

          {/* Everyone's profiles */}
          <h2 className="text-vt-white text-sm mb-3">everyone</h2>
          <div className="flex flex-col gap-3">
            {individual_profiles.map((profile, idx) => (
              <div key={idx} className="writeup-card">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-vt-white font-medium">{profile.name}</span>
                  {profile.name === participantName && (
                    <span className="text-vt-gray text-xs">(you)</span>
                  )}
                </div>
                <p className="text-vt-gray text-sm">
                  {[
                    profile.totalLoved > 0 ? `${profile.totalLoved} loved` : '',
                    profile.totalLiked > 0 ? `${profile.totalLiked} liked` : '',
                    profile.totalTry > 0 ? `${profile.totalTry} to try` : ''
                  ].filter(Boolean).join(', ') || 'no strong opinions'}
                </p>
                {profile.topCuisines.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {profile.topCuisines.map((c, i) => (
                      <span key={i} className="text-xs text-vt-gray">{formatCategory(c)}{i < profile.topCuisines.length - 1 ? ',' : ''}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Personal Results */}
      {activeTab === 'personal' && (
        <div className="flex-1 flex flex-col animate-fade-in">
          {myProfile ? (
            <>
              {/* Taste profile */}
              <div className="mb-8">
                <h2 className="text-vt-white text-sm mb-3">your taste</h2>
                {myProfile.topCuisines.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {myProfile.topCuisines.map((c, i) => (
                      <span key={i} className="px-3 py-1 text-sm border border-vt-darkgray text-vt-light rounded-full">
                        {formatCategory(c)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-vt-gray text-sm">not enough data to determine your taste</p>
                )}
              </div>

              {/* Your favorites */}
              {myProfile.lovedPlaces.length > 0 && (
                <>
                  <h2 className="text-vt-white text-sm mb-3">your favorites</h2>
                  <div className="flex flex-col gap-4 mb-8">
                    {myProfile.lovedPlaces.map((place, idx) => (
                      <PlaceCard key={place.id || idx} place={place} />
                    ))}
                  </div>
                </>
              )}

              {/* Liked places */}
              {myProfile.likedPlaces?.length > 0 && (
                <>
                  <h2 className="text-vt-white text-sm mb-3">you like these</h2>
                  <div className="flex flex-col gap-4 mb-8">
                    {myProfile.likedPlaces.map((place, idx) => (
                      <PlaceCard key={place.id || idx} place={place} />
                    ))}
                  </div>
                </>
              )}

              {/* Places to try */}
              {myProfile.wantToTryPlaces.length > 0 && (
                <>
                  <h2 className="text-vt-white text-sm mb-3">on your radar</h2>
                  <p className="text-vt-gray text-xs mb-3">you haven't been — maybe it's time</p>
                  <div className="flex flex-col gap-4 mb-8">
                    {myProfile.wantToTryPlaces.map((place, idx) => (
                      <PlaceCard key={place.id || idx} place={place} />
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="text-vt-gray">profile not found</div>
          )}
        </div>
      )}

      {/* Map View */}
      {activeTab === 'map' && (
        <div className="flex-1 flex flex-col animate-fade-in">
          <div className="mb-4">
            <h2 className="text-vt-white text-sm mb-2">all recommendations</h2>
            <p className="text-vt-gray text-xs">tap a place to get directions</p>
          </div>

          {(() => {
            const allPlaces = [...shared_favorites, ...places_to_try, ...best_bets, ...fallback_picks];
            const placesWithCoords = allPlaces.filter(p => p.lat && p.lon);

            if (placesWithCoords.length === 0) {
              return <p className="text-vt-gray">no places with location data</p>;
            }

            // Calculate center point
            const avgLat = placesWithCoords.reduce((sum, p) => sum + p.lat, 0) / placesWithCoords.length;
            const avgLon = placesWithCoords.reduce((sum, p) => sum + p.lon, 0) / placesWithCoords.length;

            // Create OpenStreetMap embed URL
            const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${avgLon - 0.02}%2C${avgLat - 0.015}%2C${avgLon + 0.02}%2C${avgLat + 0.015}&layer=mapnik`;

            return (
              <>
                <div className="relative w-full h-64 mb-6 border border-vt-darkgray overflow-hidden">
                  <iframe
                    src={mapUrl}
                    className="w-full h-full border-0"
                    title="Map view"
                  />
                  <div className="absolute bottom-2 right-2 bg-vt-black/80 px-2 py-1 text-xs text-vt-gray">
                    {placesWithCoords.length} places
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  {placesWithCoords.map((place, idx) => (
                    <a
                      key={place.id || idx}
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}${place.address ? '+' + encodeURIComponent(place.address) : ''}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-3 border border-vt-darkgray hover:border-vt-light transition-colors"
                    >
                      <div className="w-6 h-6 flex items-center justify-center bg-vt-darkgray text-vt-white text-xs font-medium">
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-vt-white text-sm truncate">{place.name}</div>
                        {place.address && (
                          <div className="text-vt-gray text-xs truncate">{place.address}</div>
                        )}
                      </div>
                      <span className="text-vt-gray text-xs">directions</span>
                    </a>
                  ))}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Actions */}
      <div className="mt-8 pt-6 border-t border-vt-darkgray">
        <button
          onClick={onNewSession}
          className="w-full py-3 bg-vt-white text-vt-black font-medium"
        >
          new session
        </button>
      </div>
    </div>
  );
}

export default LocalsResults;
