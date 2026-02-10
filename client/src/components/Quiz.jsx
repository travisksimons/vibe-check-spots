import React, { useState } from 'react';

function Quiz({ questions, participantName, onSubmit, onComplete, onBack }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);

  if (!questions || questions.length === 0) {
    return (
      <div className="min-h-screen bg-vt-black flex flex-col items-center justify-center px-6 py-12">
        <div className="text-vt-gray mb-4">loading questions...</div>
        {onBack && (
          <button
            onClick={onBack}
            className="text-vt-gray text-sm hover:text-vt-white"
          >
            back to lobby
          </button>
        )}
      </div>
    );
  }

  const currentQuestion = questions[currentIndex];
  const progress = ((currentIndex + 1) / questions.length) * 100;

  const handleSelect = (choice) => {
    setAnswers({
      ...answers,
      [currentQuestion.id]: choice
    });
  };

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
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

  const isAnswered = answers[currentQuestion?.id] !== undefined;
  const isLastQuestion = currentIndex === questions.length - 1;
  const allAnswered = Object.keys(answers).length === questions.length;

  return (
    <div className="min-h-screen bg-vt-black flex flex-col px-6 py-8">
      {/* Progress */}
      <div className="mb-8">
        <div className="flex justify-between items-center mb-2">
          <span className="text-vt-gray text-xs">question {currentIndex + 1} of {questions.length}</span>
          <span className="text-vt-gray text-xs">{Math.round(progress)}%</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Question */}
      <div className="flex-1 flex flex-col">
        <h1 className="text-xl text-vt-white mb-8 text-center">
          {currentQuestion?.dimension || ''}
        </h1>

        {/* Choices */}
        <div className="flex flex-col gap-4">
          <button
            onClick={() => {
              handleSelect(currentQuestion?.left);
              handleNext();
            }}
            className={`quiz-card py-8 px-4 text-center border transition-all ${
              answers[currentQuestion?.id] === currentQuestion?.left
                ? 'border-vt-white bg-vt-white text-vt-black'
                : 'border-vt-darkgray text-vt-white hover:border-vt-light'
            }`}
          >
            <span className="text-lg">{currentQuestion?.left}</span>
          </button>

          <div className="flex items-center justify-center py-2">
            <span className="text-vt-gray text-sm">or</span>
          </div>

          <button
            onClick={() => {
              handleSelect(currentQuestion?.right);
              handleNext();
            }}
            className={`quiz-card py-8 px-4 text-center border transition-all ${
              answers[currentQuestion?.id] === currentQuestion?.right
                ? 'border-vt-white bg-vt-white text-vt-black'
                : 'border-vt-darkgray text-vt-white hover:border-vt-light'
            }`}
          >
            <span className="text-lg">{currentQuestion?.right}</span>
          </button>
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

        {isLastQuestion && allAnswered ? (
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
            disabled={!isAnswered}
            className="flex-1 py-4 bg-vt-white text-vt-black font-medium disabled:opacity-30 disabled:cursor-not-allowed"
          >
            next
          </button>
        )}
      </div>

      {/* Progress dots */}
      <div className="mt-6 flex justify-center gap-1">
        {questions.map((q, idx) => (
          <div
            key={q.id}
            className={`w-2 h-2 rounded-full transition-all ${
              idx === currentIndex
                ? 'bg-vt-white'
                : answers[q.id] !== undefined
                ? 'bg-vt-gray'
                : 'bg-vt-dark'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

export default Quiz;