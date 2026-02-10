import React, { useState } from 'react';

function LocalsQuiz({ places, participantName, onSubmit, onComplete, onBack }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);

  if (!places || places.length === 0) {
    return (
      <div className="min-h-screen bg-vt-black flex flex-col px-6 py-8">
        {/* Skeleton Progress */}
        <div className="mb-8">
          <div className="flex justify-between mb-2">
            <div className="skeleton w-20 h-4"></div>
            <div className="skeleton w-8 h-4"></div>
          </div>
          <div className="skeleton w-full h-1"></div>
        </div>

        {/* Skeleton Place Card */}
        <div className="flex-1 flex flex-col items-center justify-center text-center mb-8">
          <div className="skeleton w-48 h-8 mb-4"></div>
          <div className="flex gap-2 mb-4">
            <div className="skeleton w-16 h-6 rounded-full"></div>
            <div className="skeleton w-16 h-6 rounded-full"></div>
          </div>
          <div className="skeleton w-64 h-4 mb-2"></div>
          <div className="skeleton w-32 h-3"></div>
        </div>

        {/* Skeleton Vote Buttons */}
        <div className="flex flex-col gap-2">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="skeleton w-full h-12"></div>
          ))}
        </div>

        {onBack && (
          <button onClick={onBack} className="text-vt-gray text-sm hover:text-vt-white mt-8 text-center">
            back to lobby
          </button>
        )}
      </div>
    );
  }

  const currentPlace = places[currentIndex];
  const progress = ((currentIndex + 1) / places.length) * 100;

  const handleVote = (vote) => {
    setAnswers({ ...answers, [currentPlace.id]: vote });
    // Auto-advance unless last
    if (currentIndex < places.length - 1) {
      setTimeout(() => setCurrentIndex(currentIndex + 1), 150);
    }
  };

  const handleNext = () => {
    if (currentIndex < places.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await onSubmit(answers);
      onComplete();
    } catch (err) {
      console.error('Failed to submit:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const currentAnswer = answers[currentPlace?.id];
  const isLastPlace = currentIndex === places.length - 1;
  const allAnswered = Object.keys(answers).length === places.length;

  const cuisineTags = currentPlace?.cuisine
    ? currentPlace.cuisine.split(';').map(c => c.trim()).filter(Boolean)
    : [];

  return (
    <div className="min-h-screen bg-vt-black flex flex-col px-6 py-8">
      {/* Progress */}
      <div className="mb-8">
        <div className="flex justify-between items-center mb-2">
          <span className="text-vt-gray text-xs">place {currentIndex + 1} of {places.length}</span>
          <span className="text-vt-gray text-xs">{Math.round(progress)}%</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Place Card */}
      <div className="flex-1 flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center text-center mb-8">
          <h1 className="text-2xl text-vt-white mb-4">{currentPlace?.name}</h1>

          {cuisineTags.length > 0 && (
            <div className="flex flex-wrap gap-2 justify-center mb-4">
              {cuisineTags.map((tag, idx) => (
                <span key={idx} className="px-3 py-1 text-xs rounded-full border border-vt-darkgray text-vt-gray">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {currentPlace?.address && (
            <p className="text-vt-gray text-sm mb-2">{currentPlace.address}</p>
          )}
          {currentPlace?.hours && (
            <p className="text-vt-gray text-xs">{currentPlace.hours}</p>
          )}
        </div>

        {/* Vote Buttons */}
        <div className="flex flex-col gap-2">
          {[
            { value: 'love', label: 'love it', selectedClass: 'border-vt-white bg-vt-white text-vt-black' },
            { value: 'like', label: 'it\'s good', selectedClass: 'border-vt-light bg-vt-dark text-vt-white' },
            { value: 'meh', label: 'it\'s fine', selectedClass: 'border-vt-gray bg-vt-dark text-vt-gray' },
            { value: 'unknown', label: 'never been', selectedClass: 'border-vt-gray text-vt-gray' },
            { value: 'nope', label: 'not for me', selectedClass: 'border-vt-gray text-vt-gray opacity-60' },
          ].map(option => (
            <button
              key={option.value}
              onClick={() => handleVote(option.value)}
              className={`py-3 px-4 text-center border transition-all ${
                currentAnswer === option.value
                  ? option.selectedClass
                  : 'border-vt-darkgray text-vt-gray hover:border-vt-light'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Navigation */}
      <div className="mt-8 flex gap-4">
        {currentIndex > 0 && (
          <button
            onClick={handlePrev}
            className="flex-1 py-4 border border-vt-darkgray text-vt-white hover:border-vt-white transition-colors"
          >
            back
          </button>
        )}

        {isLastPlace && allAnswered ? (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 py-4 bg-vt-white text-vt-black font-medium disabled:opacity-50"
          >
            {submitting ? 'submitting...' : 'submit'}
          </button>
        ) : (
          <button
            onClick={handleNext}
            disabled={!currentAnswer}
            className="flex-1 py-4 bg-vt-white text-vt-black font-medium disabled:opacity-30 disabled:cursor-not-allowed"
          >
            next
          </button>
        )}
      </div>

      {/* Progress dots */}
      <div className="mt-6 flex justify-center gap-1 flex-wrap">
        {places.map((p, idx) => (
          <div
            key={p.id}
            className={`w-2 h-2 rounded-full transition-all ${
              idx === currentIndex
                ? 'bg-vt-white'
                : answers[p.id] !== undefined
                ? 'bg-vt-gray'
                : 'bg-vt-dark'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

export default LocalsQuiz;
