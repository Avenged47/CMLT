import { useEffect, useState } from "react";
import "./App.css";

const QUIZ_DURATION_SECONDS = 2 * 60 * 60;
const PREVIEW_LIMIT = 220;
const PASS_MARK = 70;
const OPTION_LABELS = ["A", "B", "C", "D"];
const DATASET_FILES = {
  cmltPreparation: "/data/cmlt_preparation.json",
};

const ACTIVE_SET = "cmltPreparation";

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

const parsePreparationRows = (rawText) => {
  let content = String(rawText ?? "").trim();

  try {
    const parsed = JSON.parse(content);
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length === 1
    ) {
      const [singleKey] = Object.keys(parsed);
      content = singleKey;
    }
  } catch {
    // Not valid JSON object; parse as plain text.
  }

  content = content.replace(/^\uFEFF/, "");

  const pattern =
    /(\d+)\.\s*([\s\S]*?)\nA\.\s*([\s\S]*?)\nB\.\s*([\s\S]*?)\nC\.\s*([\s\S]*?)\nD\.\s*([\s\S]*?)\nAnswer:\s*([A-D])\./g;

  const rows = [];
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const [, , question, opa, opb, opc, opd, answerLetter] = match;
    rows.push({
      question: trimText(question),
      opa: trimText(opa),
      opb: trimText(opb),
      opc: trimText(opc),
      opd: trimText(opd),
      cop: OPTION_LABELS.indexOf(answerLetter) + 1,
      subject_name: "cmlt_preparation",
    });
  }

  return rows;
};

const parseDatasetRows = (rawText, setName) => {
  if (setName === "cmltPreparation") {
    return parsePreparationRows(rawText);
  }

  return parseJsonLines(rawText);
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

  return cleanedRows;
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

const getPaletteRangeClass = (questionNumber) => {
  if (questionNumber <= 20) return "range-1-20";
  if (questionNumber <= 40) return "range-21-40";
  if (questionNumber <= 60) return "range-41-60";
  if (questionNumber <= 70) return "range-61-70";
  if (questionNumber <= 80) return "range-71-80";
  if (questionNumber <= 85) return "range-81-85";
  if (questionNumber <= 90) return "range-86-90";
  if (questionNumber <= 95) return "range-91-95";
  return "range-96-100";
};

function App() {
  const [quizData, setQuizData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [userAnswers, setUserAnswers] = useState([]);
  const [timeLeft, setTimeLeft] = useState(QUIZ_DURATION_SECONDS);

  useEffect(() => {
    let isCancelled = false;

    const loadQuiz = async () => {
      setIsLoading(true);
      setLoadError("");

      try {
        const rawData = await fetchDataset(ACTIVE_SET);
        const rows = parseDatasetRows(rawData, ACTIVE_SET);
        const generatedQuiz = createQuizData(rows);
        if (generatedQuiz.length === 0) {
          throw new Error("No usable questions found in cmlt_preparation.json");
        }

        if (!isCancelled) {
          setQuizData(generatedQuiz);
          setCurrentQuestionIndex(0);
          setSelectedOption(null);
          setIsSubmitted(false);
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
  }, []);

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

  useEffect(() => {
    setSelectedOption(userAnswers[currentQuestionIndex] ?? null);
  }, [currentQuestionIndex, userAnswers]);

  if (isLoading) {
    return (
      <main className="app-shell">
        <section className="quiz-card result-card">
          <p className="eyebrow">Loading</p>
          <h1>Preparing questions from cmlt_preparation.json...</h1>
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

  const answeredCount = userAnswers.filter(
    (answer) => answer !== null && answer !== undefined,
  ).length;
  const unansweredCount = quizData.length - answeredCount;
  const progressPercent = Math.round((answeredCount / quizData.length) * 100);

  const evaluatedAnswers = quizData.map((question, index) => {
    const selected = userAnswers[index];
    return {
      selectedOption: selected,
      isCorrect: selected === question.answerIndex,
      category: question.category,
      isAnswered: selected !== null && selected !== undefined,
    };
  });

  const score = evaluatedAnswers.filter((item) => item.isCorrect).length;

  const summary = {};
  evaluatedAnswers.forEach((item) => {
    if (!item.isAnswered) {
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

  const handleSelectOption = (value) => {
    setSelectedOption(value);
    setUserAnswers((previousAnswers) => {
      const nextAnswers = [...previousAnswers];
      nextAnswers[currentQuestionIndex] = value;
      return nextAnswers;
    });
  };

  const handleNext = () => {
    const isLastQuestion = currentQuestionIndex === quizData.length - 1;
    if (isLastQuestion) {
      setIsSubmitted(true);
      return;
    }

    setCurrentQuestionIndex((prevIndex) => prevIndex + 1);
  };

  const handleQuestionJump = (index) => {
    setCurrentQuestionIndex(index);
  };

  const restartQuiz = () => {
    setQuizData((previousQuizData) => [...previousQuizData]);
    setCurrentQuestionIndex(0);
    setSelectedOption(null);
    setIsSubmitted(false);
    setUserAnswers([]);
    setTimeLeft(QUIZ_DURATION_SECONDS);
  };

  if (isSubmitted || isFinished) {
    const percentage = Math.round((score / quizData.length) * 100);
    const isPass = percentage >= PASS_MARK;
    const reviewedQuestions = quizData.map((question, index) => {
      const selectedOption = userAnswers[index];
      const isAnswered =
        selectedOption !== null && selectedOption !== undefined;
      const isCorrect = isAnswered && selectedOption === question.answerIndex;

      return {
        index,
        question: question.question,
        isAnswered,
        isCorrect,
        selectedText: isAnswered
          ? question.options[selectedOption]
          : "Not answered",
        correctText: question.options[question.answerIndex],
      };
    });

    return (
      <main className="app-shell">
        <section className="quiz-card result-card">
          <p className="eyebrow">License Preparation Result</p>
          <h1>{isPass ? 'Status: "Pass"' : 'Status: "Failed"'}</h1>
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

          <div className="review-list">
            {reviewedQuestions.map((item) => (
              <div
                key={`review-${item.index + 1}`}
                className={`review-item ${item.isCorrect ? "is-correct" : item.isAnswered ? "is-wrong" : "is-unanswered"}`}
              >
                <div className="review-head">
                  <strong>Question {item.index + 1}</strong>
                  <span
                    className={`review-status ${item.isCorrect ? "is-correct" : item.isAnswered ? "is-wrong" : "is-unanswered"}`}
                  >
                    {item.isCorrect
                      ? "Correct"
                      : item.isAnswered
                        ? "Wrong"
                        : "Not Answered"}
                  </span>
                </div>
                <p className="review-question">{item.question}</p>
                <p>
                  <strong>Your Answer:</strong>{" "}
                  <span
                    className={`review-answer-text ${item.isCorrect ? "is-correct" : item.isAnswered ? "is-wrong" : "is-unanswered"}`}
                  >
                    {item.selectedText}
                  </span>
                </p>
                <p>
                  <strong>Correct Answer:</strong>{" "}
                  <span className="review-correct-text">
                    {item.correctText}
                  </span>
                </p>
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
      <div className="quiz-layout">
        <section className="quiz-card quiz-main">
          <div className="top-meta">
            <p className="eyebrow">License Prep Practice</p>
            <p className="score-chip">
              Answered: {answeredCount}/{quizData.length}
            </p>
          </div>

          <div className="top-meta" style={{ marginTop: 8 }}>
            <p className="eyebrow">Timer</p>
            <p className="score-chip">{timerLabel}</p>
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
                  onChange={() => handleSelectOption(index)}
                />
                <span className="option-label">{OPTION_LABELS[index]}</span>
                <span title={option}>{truncateText(option)}</span>
              </label>
            ))}
          </div>

          <div className="actions">
            <p className="progress">{progressLabel}</p>
            <button type="button" className="primary-btn" onClick={handleNext}>
              {currentQuestionIndex === quizData.length - 1
                ? "Submit Exam"
                : "Next"}
            </button>
          </div>
        </section>

        <aside className="quiz-card palette-card" aria-label="Question status">
          <p className="eyebrow">Question Panel</p>
          <div className="palette-summary">
            <p className="score-chip">Answered: {answeredCount}</p>
            <p className="score-chip palette-left">Left: {unansweredCount}</p>
          </div>
          <div className="question-palette">
            {quizData.map((_, index) => {
              const questionNumber = index + 1;
              const hasAnswer =
                userAnswers[index] !== null && userAnswers[index] !== undefined;
              const isCurrent = index === currentQuestionIndex;
              const rangeClass = getPaletteRangeClass(questionNumber);
              return (
                <button
                  type="button"
                  key={`q-${questionNumber}`}
                  className={`palette-btn ${rangeClass} ${hasAnswer ? "is-answered" : ""} ${isCurrent ? "is-current" : ""}`}
                  onClick={() => handleQuestionJump(index)}
                  aria-label={`Go to question ${questionNumber}`}
                >
                  {questionNumber}
                </button>
              );
            })}
          </div>
        </aside>
      </div>
    </main>
  );
}

export default App;
