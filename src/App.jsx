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
const EXAM_STATE_STORAGE_KEY = "cmlt_exam_state_v1";
const SUBJECT_MARK_DISTRIBUTION = [
  { sn: "1.", subject: "Clinical Biochemistry", marks: "20%" },
  { sn: "2.", subject: "Clinical Haematology", marks: "20%" },
  {
    sn: "3.",
    subject: "Clinical Microbiology and Immunology",
    marks: "20%",
  },
  { sn: "4.", subject: "Histo/Cytopatological Techniques", marks: "10%" },
  { sn: "5.", subject: "Anatomy and Physiology", marks: "10%" },
  { sn: "6.", subject: "Clinical Parasitology", marks: "5%" },
  { sn: "7.", subject: "Instrumentation and Automation", marks: "5%" },
  { sn: "8.", subject: "Blood Banking", marks: "5%" },
  { sn: "9.", subject: "Pathology", marks: "5%" },
];

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

const loadSavedExamState = () => {
  try {
    const rawValue = window.localStorage.getItem(EXAM_STATE_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }
    return JSON.parse(rawValue);
  } catch {
    return null;
  }
};

const saveExamState = (state) => {
  try {
    window.localStorage.setItem(EXAM_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage write failures.
  }
};

const clearSavedExamState = () => {
  try {
    window.localStorage.removeItem(EXAM_STATE_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
};

function App() {
  const [quizData, setQuizData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [hasStarted, setHasStarted] = useState(false);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [userAnswers, setUserAnswers] = useState([]);
  const [markedForReview, setMarkedForReview] = useState([]);
  const [timeLeft, setTimeLeft] = useState(QUIZ_DURATION_SECONDS);
  const [examEndTime, setExamEndTime] = useState(null);
  const [isSubmitDialogOpen, setIsSubmitDialogOpen] = useState(false);
  const [pendingMarkedNumbers, setPendingMarkedNumbers] = useState([]);

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
          const savedState = loadSavedExamState();
          const hasValidSavedState =
            savedState &&
            savedState.activeSet === ACTIVE_SET &&
            savedState.totalQuestions === generatedQuiz.length &&
            !savedState.isSubmitted;

          const nextAnswers = hasValidSavedState
            ? generatedQuiz.map((_, index) => {
                const answer = savedState.userAnswers?.[index];
                if (answer === null || answer === undefined) {
                  return null;
                }
                return Number.isInteger(answer) && answer >= 0 && answer < 4
                  ? answer
                  : null;
              })
            : [];

          const nextReviewFlags = hasValidSavedState
            ? generatedQuiz.map((_, index) =>
                Boolean(savedState.markedForReview?.[index]),
              )
            : [];

          const nextQuestionIndex = hasValidSavedState
            ? Math.min(
                Math.max(0, Number(savedState.currentQuestionIndex) || 0),
                generatedQuiz.length - 1,
              )
            : 0;

          const now = Date.now();
          let nextEndTime = null;
          let nextTimeLeft = QUIZ_DURATION_SECONDS;
          let nextIsSubmitted = false;
          let nextHasStarted = false;

          if (hasValidSavedState) {
            nextHasStarted = true;

            if (typeof savedState.examEndTime === "number") {
              nextEndTime = savedState.examEndTime;
              nextTimeLeft = Math.max(
                0,
                Math.floor((savedState.examEndTime - now) / 1000),
              );
            } else if (typeof savedState.timeLeft === "number") {
              nextTimeLeft = Math.max(0, Math.floor(savedState.timeLeft));
              nextEndTime = now + nextTimeLeft * 1000;
            }

            if (nextTimeLeft === 0) {
              nextIsSubmitted = true;
              clearSavedExamState();
            }
          }

          setQuizData(generatedQuiz);
          setHasStarted(nextHasStarted);
          setCurrentQuestionIndex(nextQuestionIndex);
          setSelectedOption(null);
          setIsSubmitted(nextIsSubmitted);
          setUserAnswers(nextAnswers);
          setMarkedForReview(nextReviewFlags);
          setTimeLeft(nextTimeLeft);
          setExamEndTime(nextEndTime);
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
    if (
      isLoading ||
      !hasStarted ||
      isSubmitted ||
      quizData.length === 0 ||
      !examEndTime
    ) {
      return undefined;
    }

    const tickTimer = () => {
      const remainingSeconds = Math.max(
        0,
        Math.floor((examEndTime - Date.now()) / 1000),
      );
      setTimeLeft(remainingSeconds);

      if (remainingSeconds === 0) {
        setIsSubmitted(true);
      }
    };

    tickTimer();

    const timerId = window.setInterval(() => {
      tickTimer();
    }, 1000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [isLoading, hasStarted, isSubmitted, quizData.length, examEndTime]);

  useEffect(() => {
    if (isLoading || !hasStarted || isSubmitted || !examEndTime) {
      return;
    }

    saveExamState({
      activeSet: ACTIVE_SET,
      totalQuestions: quizData.length,
      currentQuestionIndex,
      userAnswers,
      markedForReview,
      isSubmitted,
      examEndTime,
      timeLeft,
    });
  }, [
    isLoading,
    hasStarted,
    isSubmitted,
    examEndTime,
    quizData.length,
    currentQuestionIndex,
    userAnswers,
    markedForReview,
    timeLeft,
  ]);

  useEffect(() => {
    if (isSubmitted) {
      clearSavedExamState();
    }
  }, [isSubmitted]);

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
  const reviewCount = markedForReview.filter(Boolean).length;
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
  quizData.forEach((question, index) => {
    const key = question.category;
    const selected = userAnswers[index];
    const isAnswered = selected !== null && selected !== undefined;
    const isCorrect = isAnswered && selected === question.answerIndex;
    const isReview = Boolean(markedForReview[index]);

    if (!summary[key]) {
      summary[key] = {
        totalQuestions: 0,
        attempted: 0,
        correct: 0,
        wrong: 0,
        unanswered: 0,
        reviewMarked: 0,
      };
    }

    summary[key].totalQuestions += 1;
    if (isReview) {
      summary[key].reviewMarked += 1;
    }

    if (!isAnswered) {
      summary[key].unanswered += 1;
      return;
    }

    summary[key].attempted += 1;
    if (isCorrect) {
      summary[key].correct += 1;
    } else {
      summary[key].wrong += 1;
    }
  });

  const categorySummary = Object.entries(summary)
    .map(([category, stats]) => ({
      category,
      totalQuestions: stats.totalQuestions,
      attempted: stats.attempted,
      correct: stats.correct,
      wrong: stats.wrong,
      unanswered: stats.unanswered,
      reviewMarked: stats.reviewMarked,
      accuracy:
        stats.attempted > 0
          ? Math.round((stats.correct / stats.attempted) * 100)
          : 0,
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

    // If user answered this question, clear review flag to avoid accidental leftover marks.
    if (markedForReview[currentQuestionIndex]) {
      setMarkedForReview((previous) => {
        const next = [...previous];
        next[currentQuestionIndex] = false;
        return next;
      });
    }
  };

  const handleNext = () => {
    const isLastQuestion = currentQuestionIndex === quizData.length - 1;
    if (isLastQuestion) {
      const markedNumbers = quizData
        .map((_, index) => (markedForReview[index] ? index + 1 : null))
        .filter((value) => value !== null);
      setPendingMarkedNumbers(markedNumbers);
      setIsSubmitDialogOpen(true);
      return;
    }

    setCurrentQuestionIndex((prevIndex) => prevIndex + 1);
  };

  const handlePrevious = () => {
    setCurrentQuestionIndex((prevIndex) => Math.max(0, prevIndex - 1));
  };

  const handleToggleReview = () => {
    setMarkedForReview((previous) => {
      const next = [...previous];
      next[currentQuestionIndex] = !next[currentQuestionIndex];
      return next;
    });
  };

  const handleQuestionJump = (index) => {
    setCurrentQuestionIndex(index);
  };

  const handleSubmitNow = () => {
    setIsSubmitDialogOpen(false);
    setIsSubmitted(true);
  };

  const handleBackToQuestion = () => {
    setIsSubmitDialogOpen(false);
    if (pendingMarkedNumbers.length > 0) {
      setCurrentQuestionIndex(pendingMarkedNumbers[0] - 1);
    }
  };

  const restartQuiz = () => {
    setQuizData((previousQuizData) => [...previousQuizData]);
    setHasStarted(false);
    setCurrentQuestionIndex(0);
    setSelectedOption(null);
    setIsSubmitted(false);
    setIsSubmitDialogOpen(false);
    setPendingMarkedNumbers([]);
    setUserAnswers([]);
    setMarkedForReview([]);
    setTimeLeft(QUIZ_DURATION_SECONDS);
    setExamEndTime(null);
    clearSavedExamState();
  };

  const handleStartExam = () => {
    setHasStarted(true);

    if (!examEndTime) {
      setTimeLeft(QUIZ_DURATION_SECONDS);
      setExamEndTime(Date.now() + QUIZ_DURATION_SECONDS * 1000);
    }
  };

  if (!hasStarted && !isSubmitted) {
    return (
      <main className="app-shell">
        <section className="quiz-card result-card">
          <p className="eyebrow">CMLT Exam</p>
          <h1>Ready To Start Your Exam?</h1>
          <div className="exam-guide">
            <p>
              Total questions: <strong>{quizData.length}</strong>
            </p>
            <p>
              Duration: <strong>2 hours</strong>
            </p>
            <p>
              Pass mark: <strong>{PASS_MARK}%</strong> (below {PASS_MARK}% is
              "Failed")
            </p>

            <h2>Exam Instructions</h2>
            <ul>
              <li>Each question has one correct answer.</li>
              <li>
                Use Next, Previous, or the question panel to move between
                questions.
              </li>
              <li>Answered questions are highlighted in the question panel.</li>
              <li>
                Refreshing during exam will resume your in-progress attempt.
              </li>
              <li>Submit on the last question or when time reaches 00:00.</li>
              <li>
                Final result includes score and full correct/wrong review.
              </li>
            </ul>

            <h2>Rules And Regulations</h2>
            <ul>
              <li>
                Total exam duration is fixed and the timer runs continuously.
              </li>
              <li>
                If you select or change an answer, that question is
                auto-unmarked from review.
              </li>
              <li>
                When time reaches 00:00, exam is auto-submitted immediately.
              </li>
              <li>
                You can change any selected answer before final submission.
              </li>
              <li>
                On final submit, you will see attempted, unattempted, and review
                counts for confirmation.
              </li>
              <li>
                Marking for review does not add or remove marks by itself.
              </li>
            </ul>

            <h2>How To Use Mark Review</h2>
            <ul>
              <li>
                Click Mark Review on a question to flag it for later checking.
              </li>
              <li>
                A marked question gets a special indicator in the question
                panel.
              </li>
              <li>
                Review count in the side panel shows how many are currently
                flagged.
              </li>
              <li>
                Click Unmark Review to remove the flag once you are satisfied.
              </li>
              <li>You can still submit with marked questions if you choose.</li>
            </ul>

            <h2>Distribution Of Marks</h2>
            <div className="distribution-wrap">
              <table
                className="distribution-table"
                aria-label="Marks distribution"
              >
                <thead>
                  <tr>
                    <th scope="col">S.N.</th>
                    <th scope="col">Subject</th>
                    <th scope="col">Marks</th>
                  </tr>
                </thead>
                <tbody>
                  {SUBJECT_MARK_DISTRIBUTION.map((item) => (
                    <tr key={item.sn}>
                      <td>{item.sn}</td>
                      <td>{item.subject}</td>
                      <td>{item.marks}</td>
                    </tr>
                  ))}
                  <tr className="distribution-total-row">
                    <td colSpan={2}>Total</td>
                    <td>100%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <button
            type="button"
            className="primary-btn"
            onClick={handleStartExam}
          >
            Start Exam
          </button>
          <p className="result-note" style={{ marginTop: 10 }}>
            Before clicking Start Exam, please read all instructions carefully.
            If there is any confusion, ask your Exam provider Mr. Anush
            Dhungana🫡😉😉.
          </p>
        </section>
      </main>
    );
  }

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
                <span>Questions: {item.totalQuestions}</span>
                <span>Attempted: {item.attempted}</span>
                <span>Correct: {item.correct}</span>
                <span>Wrong: {item.wrong}</span>
                <span>Unanswered: {item.unanswered}</span>
                <span>Marked Review: {item.reviewMarked}</span>
                <span>Accuracy: {item.accuracy}%</span>
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
            <div className="actions-group">
              <button
                type="button"
                className="primary-btn secondary-btn"
                onClick={handlePrevious}
                disabled={currentQuestionIndex === 0}
              >
                Previous
              </button>
              <button
                type="button"
                className="primary-btn review-btn"
                onClick={handleToggleReview}
              >
                {markedForReview[currentQuestionIndex]
                  ? "Unmark Review"
                  : "Mark Review"}
              </button>
              <button
                type="button"
                className="primary-btn"
                onClick={handleNext}
              >
                {currentQuestionIndex === quizData.length - 1
                  ? "Submit Exam"
                  : "Next"}
              </button>
            </div>
          </div>
        </section>

        <aside className="quiz-card palette-card" aria-label="Question status">
          <p className="eyebrow">Question Panel</p>
          <div className="palette-summary">
            <p className="score-chip">Answered: {answeredCount}</p>
            <p className="score-chip palette-left">Left: {unansweredCount}</p>
            <p className="score-chip palette-review">Review: {reviewCount}</p>
          </div>
          <div className="question-palette">
            {quizData.map((_, index) => {
              const questionNumber = index + 1;
              const hasAnswer =
                userAnswers[index] !== null && userAnswers[index] !== undefined;
              const isReview = Boolean(markedForReview[index]);
              const isCurrent = index === currentQuestionIndex;
              const rangeClass = getPaletteRangeClass(questionNumber);
              return (
                <button
                  type="button"
                  key={`q-${questionNumber}`}
                  className={`palette-btn ${rangeClass} ${hasAnswer ? "is-answered" : ""} ${isReview ? "is-review" : ""} ${isCurrent ? "is-current" : ""}`}
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

      {isSubmitDialogOpen && (
        <div className="submit-dialog-overlay" role="dialog" aria-modal="true">
          <div className="submit-dialog-card">
            <p className="eyebrow">Confirm Submission</p>
            <h2>Submit Exam Now?</h2>
            <p>Attempted: {answeredCount}</p>
            <p>Unanswered: {unansweredCount}</p>
            <p>Marked for review: {reviewCount}</p>
            {pendingMarkedNumbers.length > 0 && (
              <p className="result-note">
                Pending review question numbers:{" "}
                {pendingMarkedNumbers.slice(0, 12).join(", ")}
                {pendingMarkedNumbers.length > 12 ? "..." : ""}
              </p>
            )}
            <div className="actions-group" style={{ justifyContent: "center" }}>
              <button
                type="button"
                className="primary-btn secondary-btn"
                onClick={handleBackToQuestion}
              >
                Back To Question
              </button>
              <button
                type="button"
                className="primary-btn"
                onClick={handleSubmitNow}
              >
                Submit Now
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
