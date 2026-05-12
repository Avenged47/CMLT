import { useEffect, useState } from "react";
import "./App.css";

const MAX_QUESTIONS = 25;
const QUIZ_DURATION_SECONDS = 30 * 60;
const PREVIEW_LIMIT = 220;
const PASS_MARK = 80;
const OPTION_LABELS = ["A", "B", "C", "D"];
const DATASET_FILES = {
  train: "/data/train.json",
  dev: "/data/dev.json",
  test: "/data/test.json",
};

const trimText = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const truncateText = (value, maxLength = PREVIEW_LIMIT) => {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}...`;
};

const shuffle = (items) => {
  const output = [...items];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [output[index], output[randomIndex]] = [output[randomIndex], output[index]];
  }
  return output;
};

const parseJsonLines = (rawText) => {
  const lines = rawText.split(/\r?\n/).filter((line) => line.trim());
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSON on line ${index + 1}`);
    }
  });
};

const fetchDataset = async (name) => {
  const url = DATASET_FILES[name];
  if (!url) throw new Error(`Unknown dataset: ${name}`);
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Could not load ${name}.json (${response.status})`);
  return response.text();
};

const createQuizData = (rows) => {
  const cleanedRows = rows
    .map((row) => {
      const question = trimText(row.question);
      const options = [row.opa, row.opb, row.opc, row.opd].map(trimText);
      const answerIndex = Number(row.cop) - 1;

      return {
        question,
        options,
        answerIndex,
        category: trimText(row.subject_name) || "general",
      };
    })
    .filter((row) => {
      const hasValidQuestion = Boolean(row.question);
      const hasFourOptions =
        row.options.length === 4 && row.options.every(Boolean);
      const hasValidAnswer = row.answerIndex >= 0 && row.answerIndex < 4;
      return hasValidQuestion && hasFourOptions && hasValidAnswer;
    });

  return shuffle(cleanedRows).slice(0, MAX_QUESTIONS);
};

const formatCategory = (value) => {
  if (!value) {
    return "General";
  }

  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
};

function App() {
  const [activeSet, setActiveSet] = useState("train");
  const [quizData, setQuizData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState(null);
  const [score, setScore] = useState(0);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isChecked, setIsChecked] = useState(false);
  const [userAnswers, setUserAnswers] = useState([]);
  const [timeLeft, setTimeLeft] = useState(QUIZ_DURATION_SECONDS);

  useEffect(() => {
    let isCancelled = false;

    const loadQuiz = async () => {
      setIsLoading(true);
      setLoadError("");

      try {
        const rawData = await fetchDataset(activeSet);
        const rows = parseJsonLines(rawData);
        const generatedQuiz = createQuizData(rows);
        if (generatedQuiz.length === 0) {
          throw new Error(`No usable questions found in ${activeSet}.json`);
        }

        if (!isCancelled) {
          setQuizData(generatedQuiz);
          setCurrentQuestionIndex(0);
          setSelectedOption(null);
          setScore(0);
          setIsSubmitted(false);
          setIsChecked(false);
          setUserAnswers([]);
          setTimeLeft(QUIZ_DURATION_SECONDS);
        }
      } catch (error) {
        if (!isCancelled) {
          setLoadError(
            error instanceof Error ? error.message : "Failed to load quiz data",
          );
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    };

    loadQuiz();

    return () => {
      isCancelled = true;
    };
  }, [activeSet]);

  useEffect(() => {
    if (isLoading || isSubmitted || quizData.length === 0) {
      return undefined;
    }

    const timerId = window.setInterval(() => {
      setTimeLeft((previous) => {
        if (previous <= 1) {
          window.clearInterval(timerId);
          setIsSubmitted(true);
          return 0;
        }
        return previous - 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [isLoading, isSubmitted, quizData.length]);

  if (isLoading) {
    return (
      <main className="app-shell">
        <section className="quiz-card result-card">
          <p className="eyebrow">Loading</p>
          <h1>Preparing questions from {activeSet}.json...</h1>
        </section>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="app-shell">
        <section className="quiz-card result-card">
          <p className="eyebrow">Data Error</p>
          <h1>Could not load quiz data</h1>
          <p>{loadError}</p>
        </section>
      </main>
    );
  }

  const currentQuestion = quizData[currentQuestionIndex];
  const isFinished = currentQuestionIndex >= quizData.length;
  const currentAnswer = userAnswers[currentQuestionIndex];

  const answeredCount = userAnswers.filter(Boolean).length;
  const progressPercent = Math.round((answeredCount / quizData.length) * 100);

  const summary = {};
  userAnswers.forEach((item) => {
    if (!item) {
      return;
    }

    const key = item.category;
    if (!summary[key]) {
      summary[key] = { total: 0, correct: 0 };
    }

    summary[key].total += 1;
    if (item.isCorrect) {
      summary[key].correct += 1;
    }
  });

  const categorySummary = Object.entries(summary)
    .map(([category, stats]) => ({
      category,
      total: stats.total,
      correct: stats.correct,
    }))
    .sort((a, b) => a.category.localeCompare(b.category));

  const progressLabel = isFinished
    ? "Quiz complete"
    : `Question ${currentQuestionIndex + 1} of ${quizData.length}`;

  const minutesLeft = Math.floor(timeLeft / 60);
  const secondsLeft = timeLeft % 60;
  const timerLabel = `${String(minutesLeft).padStart(2, "0")}:${String(
    secondsLeft,
  ).padStart(2, "0")}`;

  const handleCheckAnswer = () => {
    if (selectedOption === null) {
      return;
    }

    if (currentAnswer) {
      setIsChecked(true);
      return;
    }

    const isCorrect = selectedOption === currentQuestion.answerIndex;
    if (isCorrect) {
      setScore((prevScore) => prevScore + 1);
    }

    setUserAnswers((previousAnswers) => {
      const nextAnswers = [...previousAnswers];
      nextAnswers[currentQuestionIndex] = {
        selectedOption,
        isCorrect,
        category: currentQuestion.category,
      };
      return nextAnswers;
    });

    setIsChecked(true);
  };

  const handleNext = () => {
    if (!isChecked) {
      return;
    }

    const isLastQuestion = currentQuestionIndex === quizData.length - 1;
    if (isLastQuestion) {
      setIsSubmitted(true);
      return;
    }

    setCurrentQuestionIndex((prevIndex) => prevIndex + 1);
    setSelectedOption(null);
    setIsChecked(false);
  };

  const restartQuiz = () => {
    setQuizData((previousQuizData) => shuffle(previousQuizData));
    setCurrentQuestionIndex(0);
    setSelectedOption(null);
    setScore(0);
    setIsSubmitted(false);
    setIsChecked(false);
    setUserAnswers([]);
    setTimeLeft(QUIZ_DURATION_SECONDS);
  };

  if (isSubmitted || isFinished) {
    const percentage = Math.round((score / quizData.length) * 100);
    const isPass = percentage >= PASS_MARK;

    return (
      <main className="app-shell">
        <section className="quiz-card result-card">
          <p className="eyebrow">License Preparation Result</p>
          <h1>{isPass ? "Status: Pass" : "Status: Keep Practicing"}</h1>
          <p>
            You scored <strong>{score}</strong> out of{" "}
            <strong>{quizData.length}</strong> ({percentage}%).
          </p>
          <p className="result-note">Recommended pass mark: {PASS_MARK}%</p>

          <div className="summary-grid">
            {categorySummary.map((item) => (
              <div key={item.category} className="summary-item">
                <strong>{formatCategory(item.category)}</strong>
                <span>
                  {item.correct}/{item.total} correct
                </span>
              </div>
            ))}
          </div>

          <button type="button" className="primary-btn" onClick={restartQuiz}>
            Start New Practice Set
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="quiz-card">
        <div className="top-meta">
          <p className="eyebrow">License Prep Practice</p>
          <p className="score-chip">Score: {score}</p>
        </div>

        <div className="top-meta" style={{ marginTop: 8 }}>
          <p className="eyebrow">Timer</p>
          <p className="score-chip">{timerLabel}</p>
        </div>

        <div className="actions" style={{ marginBottom: 12 }}>
          <p className="progress">Dataset</p>
          <select
            value={activeSet}
            onChange={(event) => setActiveSet(event.target.value)}
            className="primary-btn"
            style={{ paddingRight: 32 }}
            aria-label="Select dataset"
          >
            <option value="train">Train</option>
            <option value="dev">Dev</option>
            <option value="test">Test</option>
          </select>
        </div>

        <div className="progress-wrap" aria-hidden="true">
          <div className="progress-track">
            <div
              className="progress-bar"
              style={{ width: `${progressPercent}%` }}
            ></div>
          </div>
          <span className="progress-value">{progressPercent}% complete</span>
        </div>

        <p className="category-badge">
          {formatCategory(currentQuestion.category)}
        </p>
        <h1>{currentQuestion.question}</h1>
        <p className="hint">
          Loaded from {activeSet}.json in your data folder.
        </p>

        <div
          className="option-list"
          role="radiogroup"
          aria-label="Answer choices"
        >
          {currentQuestion.options.map((option, index) => (
            <label key={`${option}-${index}`} className="option-item">
              <input
                type="radio"
                name="mcq-option"
                value={index}
                checked={selectedOption === index}
                onChange={() => setSelectedOption(index)}
                disabled={isChecked}
              />
              <span className="option-label">{OPTION_LABELS[index]}</span>
              <span title={option}>{truncateText(option)}</span>
            </label>
          ))}
        </div>

        {isChecked && (
          <div
            className={
              currentAnswer?.isCorrect
                ? "feedback feedback-correct"
                : "feedback feedback-incorrect"
            }
          >
            <strong>
              {currentAnswer?.isCorrect ? "Correct" : "Incorrect"}
            </strong>
            {!currentAnswer?.isCorrect && (
              <p>
                Correct answer:{" "}
                <span
                  title={currentQuestion.options[currentQuestion.answerIndex]}
                >
                  {truncateText(
                    currentQuestion.options[currentQuestion.answerIndex],
                    260,
                  )}
                </span>
              </p>
            )}
          </div>
        )}

        <div className="actions">
          <p className="progress">{progressLabel}</p>
          {!isChecked ? (
            <button
              type="button"
              className="primary-btn"
              onClick={handleCheckAnswer}
              disabled={selectedOption === null}
            >
              Check Answer
            </button>
          ) : (
            <button type="button" className="primary-btn" onClick={handleNext}>
              {currentQuestionIndex === quizData.length - 1 ? "Submit" : "Next"}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

export default App;
