import React, { useState, useRef } from 'react';

const categories = [
  { id: 'food', label: 'food' },
  { id: 'drinks', label: 'drinks' },
  { id: 'activities', label: 'activities' }
];

function Landing({ onCreate }) {
  const [step, setStep] = useState(1);
  const [hostName, setHostName] = useState('');
  const [category, setCategory] = useState(null);
  const [discoverMode, setDiscoverMode] = useState(false);
  const [location, setLocation] = useState('');
  const [locationQuery, setLocationQuery] = useState('');
  const [locationSuggestions, setLocationSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [locationRadius, setLocationRadius] = useState(null);
  const [loading, setLoading] = useState(false);

  const radiusOptions = [
    { id: 'walkable', label: 'walkable', description: '5-10 min walk' },
    { id: 'nearby', label: 'nearby', description: '10-15 min drive' },
    { id: 'city', label: 'whole city', description: 'anywhere in the area' }
  ];
  const debounceRef = useRef(null);

  const searchLocations = async (query) => {
    if (query.length < 2) {
      setLocationSuggestions([]);
      return;
    }
    try {
      const res = await fetch(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5`
      );
      const data = await res.json();
      const suggestions = data.features?.map((f) => ({
        name: f.properties.name,
        city: f.properties.city,
        state: f.properties.state,
        country: f.properties.country,
        display: [f.properties.name, f.properties.city, f.properties.state].filter(Boolean).join(', ')
      })) || [];
      setLocationSuggestions(suggestions);
    } catch (err) {
      console.error('Location search failed:', err);
    }
  };

  const handleLocationInput = (value) => {
    setLocationQuery(value);
    setLocation(value);
    setShowSuggestions(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchLocations(value), 300);
  };

  const selectLocation = (suggestion) => {
    setLocation(suggestion.display);
    setLocationQuery(suggestion.display);
    setShowSuggestions(false);
    setLocationSuggestions([]);
  };

  const handleCreate = async () => {
    setLoading(true);
    try {
      await onCreate({
        mode: discoverMode ? 'discover' : 'locals',
        hostName,
        category,
        location: location.trim() || null,
        locationRadius: location.trim() ? locationRadius : null
      });
    } catch (err) {
      console.error('Failed to create:', err);
    } finally {
      setLoading(false);
    }
  };

  // Step 1: Name
  if (step === 1) {
    return (
      <div className="min-h-screen bg-vt-black flex flex-col px-6 py-12">
        <h1 className="text-2xl text-vt-white mb-2">vibe check</h1>
        <p className="text-vt-accent text-lg mb-6">spots</p>

        <div className="text-vt-gray text-xs leading-relaxed mb-8 p-4 border border-vt-darkgray">
          <p className="mb-2">can't decide where to eat? what to do?</p>
          <p>create a session, share the link, everyone votes on real places, and we'll find what you all actually want.</p>
        </div>

        <input
          type="text"
          placeholder="your name"
          value={hostName}
          onChange={(e) => setHostName(e.target.value)}
          className="w-full bg-transparent border-b border-vt-darkgray py-3 text-lg text-vt-white placeholder-vt-gray focus:outline-none focus:border-vt-white transition-colors"
          autoFocus
          autoComplete="off"
        />

        <button
          onClick={() => setStep(2)}
          disabled={hostName.trim().length === 0}
          className="mt-8 py-3 px-6 bg-vt-white text-vt-black font-medium disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
        >
          continue
        </button>
      </div>
    );
  }

  // Step 2: Category
  if (step === 2) {
    return (
      <div className="min-h-screen bg-vt-black flex flex-col px-6 py-12">
        <button onClick={() => setStep(1)} className="text-vt-gray text-sm mb-6">back</button>
        <h2 className="text-lg text-vt-white mb-6">what are we deciding?</h2>

        <div className="flex flex-col gap-3 mb-8">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              className={`py-4 px-4 border transition-all text-left ${
                category === cat.id
                  ? 'border-vt-white bg-vt-white text-vt-black'
                  : 'border-vt-darkgray text-vt-gray hover:border-vt-light'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setStep(3)}
          disabled={!category}
          className="mt-auto py-3 px-6 bg-vt-white text-vt-black font-medium disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
        >
          continue
        </button>
      </div>
    );
  }

  // Step 3: Location
  if (step === 3) {
    const canCreate = discoverMode || (location.trim() && locationRadius);

    return (
      <div className="min-h-screen bg-vt-black flex flex-col px-6 py-12">
        <button onClick={() => { setStep(2); setDiscoverMode(false); }} className="text-vt-gray text-sm mb-6">back</button>

        <h2 className="text-lg text-vt-white mb-2">where are you?</h2>
        <p className="text-vt-gray text-sm mb-6">
          {discoverMode
            ? "we'll suggest places based on your group's taste"
            : "we'll find real places nearby for your group to vote on"
          }
        </p>

        <div className="relative mb-6">
          <input
            type="text"
            placeholder="neighborhood or area"
            value={locationQuery}
            onChange={(e) => handleLocationInput(e.target.value)}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            className="w-full bg-transparent border-b border-vt-darkgray py-3 text-lg text-vt-white placeholder-vt-gray focus:outline-none focus:border-vt-white transition-colors"
            autoComplete="off"
          />
          {showSuggestions && locationSuggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-vt-dark border border-vt-darkgray rounded-lg overflow-hidden z-10">
              {locationSuggestions.map((suggestion, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => selectLocation(suggestion)}
                  className="w-full text-left px-4 py-3 text-sm text-vt-light hover:bg-vt-darkgray transition-colors border-b border-vt-darkgray last:border-b-0"
                >
                  {suggestion.display}
                </button>
              ))}
            </div>
          )}
        </div>

        {location.trim() && !discoverMode && (
          <div className="mb-6">
            <p className="text-vt-gray text-sm mb-3">how far are you willing to go?</p>
            <div className="flex flex-col gap-2">
              {radiusOptions.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setLocationRadius(opt.id)}
                  className={`text-left p-3 border transition-all ${
                    locationRadius === opt.id
                      ? 'border-vt-white bg-vt-white text-vt-black'
                      : 'border-vt-darkgray text-vt-light hover:border-vt-light'
                  }`}
                >
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className={`text-xs ${locationRadius === opt.id ? 'text-vt-darkgray' : 'text-vt-gray'}`}>
                    {opt.description}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() => setDiscoverMode(!discoverMode)}
          className="mb-6 text-left text-sm"
        >
          <span className={`inline-block w-4 h-4 mr-2 border ${discoverMode ? 'bg-vt-white border-vt-white' : 'border-vt-darkgray'} align-middle`}>
            {discoverMode && <span className="block w-full h-full text-vt-black text-center text-xs leading-4">✓</span>}
          </span>
          <span className="text-vt-gray">not a local? get AI recommendations instead</span>
        </button>

        <button
          onClick={handleCreate}
          disabled={loading || !canCreate}
          className="mt-auto py-3 px-6 bg-vt-white text-vt-black font-medium disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
        >
          {loading ? 'creating...' : 'start session'}
        </button>
      </div>
    );
  }

  return null;
}

export default Landing;
