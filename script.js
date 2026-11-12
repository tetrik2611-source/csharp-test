// Тест по C# с загрузкой вопросов из опубликованной Google Таблицы.
// Если Google Таблица временно недоступна, тест сразу работает на резервных вопросах.

const QUESTIONS_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSloGK3DOQV1BNea7Bqt248Fy6-cnPYPIHgHrN8GOAp4Y6qc_f7XP2yODnuPYY5xdTxBsQasiffhLk2/pub?gid=0&single=true&output=csv";
const GOOGLE_TIMEOUT_MS = 8000;
const TEST_TIME_SECONDS = 10 * 60;

// Резервные вопросы встроены в код. Поэтому сайт запускается, даже если CSV/TSV
// не удалось загрузить или файл questions.tsv оказался не в той папке.
const FALLBACK_QUESTIONS = [
  { number: "1", topic: "Типы данных", question: "Какой тип данных хранит целые числа?", options: ["int", "string", "bool", "double"], correct: 1 },
  { number: "2", topic: "Типы данных", question: "Какой тип данных хранит строку?", options: ["int", "string", "char", "bool"], correct: 2 },
  { number: "3", topic: "Вывод данных", question: "Какой командой выводят текст в консоль?", options: ["Console.ReadLine()", "Console.WriteLine()", "WriteText()", "PrintLine()"], correct: 2 },
  { number: "4", topic: "Ввод данных", question: "Какой метод считывает строку из консоли?", options: ["Console.ReadLine()", "Console.WriteLine()", "ReadText()", "Input()"], correct: 1 },
  { number: "5", topic: "Условия", question: "Какое ключевое слово используется для проверки условия?", options: ["for", "class", "if", "using"], correct: 3 },
  { number: "6", topic: "Циклы", question: "Какой цикл обычно используют, когда заранее известно число повторений?", options: ["if", "for", "try", "class"], correct: 2 },
  { number: "7", topic: "Циклы", question: "Какое ключевое слово завершает текущую итерацию цикла и переходит к следующей?", options: ["break", "return", "continue", "stop"], correct: 3 },
  { number: "8", topic: "Массивы", question: "Как получить первый элемент массива arr?", options: ["arr[1]", "arr[0]", "arr.first", "arr(0)"], correct: 2 },
  { number: "9", topic: "ООП", question: "Какое ключевое слово объявляет класс в C#?", options: ["new", "public", "void", "class"], correct: 4 },
  { number: "10", topic: "Преобразование типов", question: "Как преобразовать строку в целое число?", options: ["int.Parse()", "string.ToInt()", "Convert.String()", "Read.Int()"], correct: 1 }
];

let allQuestions = [...FALLBACK_QUESTIONS];
let questions = [];
let currentIndex = 0;
let score = 0;
let answered = false;
let secondsLeft = TEST_TIME_SECONDS;
let timerId = null;
let userInteracted = false;

const statusBox = document.getElementById("status");
const quizBox = document.getElementById("quiz");
const resultBox = document.getElementById("result");
const topicFilter = document.getElementById("topicFilter");
const questionTopic = document.getElementById("questionTopic");
const questionText = document.getElementById("questionText");
const answersBox = document.getElementById("answers");
const feedback = document.getElementById("feedback");
const nextButton = document.getElementById("nextButton");
const finishButton = document.getElementById("finishButton");

// Разбирает CSV или TSV, в том числе значения в кавычках и запятые внутри текста.
function parseDelimitedRows(sourceText, delimiter) {
  const source = String(sourceText).replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let insideQuotes = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];

    if (insideQuotes) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        insideQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field.length === 0) {
      insideQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

// Определяем разделитель по тому, какой вариант даёт больше столбцов в заголовке.
function detectDelimiter(text) {
  const firstLine = (String(text).replace(/^\uFEFF/, "").split(/\r?\n/).find(line => line.trim()) || "");
  const candidates = [",", ";", "\t"];
  let bestDelimiter = ",";
  let bestCount = 0;

  for (const delimiter of candidates) {
    const parsed = parseDelimitedRows(firstLine, delimiter);
    const count = parsed.length ? parsed[0].length : 0;
    if (count > bestCount) {
      bestCount = count;
      bestDelimiter = delimiter;
    }
  }
  return bestDelimiter;
}

function parseQuestions(text) {
  const delimiter = detectDelimiter(text);
  const rows = parseDelimitedRows(text, delimiter)
    .filter(row => row.some(cell => String(cell).trim() !== ""));

  if (rows.length < 2 || rows[0].length < 8) {
    throw new Error("В таблице должно быть 8 столбцов и хотя бы одна строка с вопросом.");
  }

  const parsed = rows.slice(1).map(cells => {
    if (!cells || cells.length < 8) return null;
    return {
      number: String(cells[0] ?? "").trim(),
      topic: String(cells[1] ?? "").trim(),
      question: String(cells[2] ?? "").trim(),
      options: cells.slice(3, 7).map(value => String(value ?? "").trim()),
      correct: Number(String(cells[7] ?? "").trim())
    };
  }).filter(q => q && q.topic && q.question && q.options.length === 4 &&
    q.options.every(Boolean) && Number.isInteger(q.correct) && q.correct >= 1 && q.correct <= 4);

  if (!parsed.length) {
    throw new Error("Не удалось прочитать строки. Проверьте 8 столбцов и правильный ответ от 1 до 4.");
  }
  return parsed;
}

async function fetchGoogleQuestions() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GOOGLE_TIMEOUT_MS);
  try {
    const separator = QUESTIONS_URL.includes("?") ? "&" : "?";
    const response = await fetch(QUESTIONS_URL + separator + "cache=" + Date.now(), {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) throw new Error("Google ответил кодом " + response.status);
    const text = await response.text();
    return parseQuestions(text);
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Google Таблица не ответила за 8 секунд.");
    }
    if (error instanceof TypeError) {
      throw new Error("Браузер не смог получить CSV (возможно, сетевое ограничение или CORS).");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function fillTopicFilter() {
  const previousValue = topicFilter.value || "Все темы";
  topicFilter.innerHTML = '<option value="Все темы">Все темы</option>';
  const topics = [...new Set(allQuestions.map(q => q.topic))];
  topics.forEach(topic => {
    const option = document.createElement("option");
    option.value = topic;
    option.textContent = topic;
    topicFilter.appendChild(option);
  });
  if ([...topicFilter.options].some(option => option.value === previousValue)) {
    topicFilter.value = previousValue;
  }
}

function startTest() {
  const selectedTopic = topicFilter.value || "Все темы";
  questions = selectedTopic === "Все темы"
    ? [...allQuestions]
    : allQuestions.filter(q => q.topic === selectedTopic);

  currentIndex = 0;
  score = 0;
  answered = false;
  secondsLeft = TEST_TIME_SECONDS;
  resultBox.hidden = true;
  quizBox.hidden = false;
  nextButton.disabled = true;
  updateTimer();

  clearInterval(timerId);
  timerId = setInterval(() => {
    secondsLeft--;
    updateTimer();
    if (secondsLeft <= 0) finishTest(true);
  }, 1000);

  showQuestion();
}

function updateTimer() {
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  document.getElementById("timer").textContent =
    `Время: ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function showQuestion() {
  if (currentIndex >= questions.length) {
    finishTest(false);
    return;
  }

  const q = questions[currentIndex];
  answered = false;
  questionTopic.textContent = "Тема: " + q.topic;
  questionText.textContent = `${currentIndex + 1}. ${q.question}`;
  feedback.textContent = "";
  feedback.className = "mt-3 fw-semibold";
  answersBox.innerHTML = "";
  nextButton.disabled = true;

  q.options.forEach((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-outline-primary answer-button";
    button.textContent = `${index + 1}. ${option}`;
    button.addEventListener("click", () => chooseAnswer(index + 1, button));
    answersBox.appendChild(button);
  });
  updateProgress();
}

function chooseAnswer(answerNumber, clickedButton) {
  if (answered) return;
  userInteracted = true;
  answered = true;
  const q = questions[currentIndex];
  const buttons = [...answersBox.querySelectorAll("button")];

  buttons.forEach((button, index) => {
    button.disabled = true;
    if (index + 1 === q.correct) button.classList.add("correct");
  });

  if (answerNumber === q.correct) {
    score++;
    feedback.textContent = "Верно!";
    feedback.className = "mt-3 fw-semibold text-success";
  } else {
    clickedButton.classList.add("wrong");
    feedback.textContent = "Неверно. Правильный ответ: " + q.options[q.correct - 1];
    feedback.className = "mt-3 fw-semibold text-danger";
  }

  nextButton.disabled = false;
  updateProgress();
}

function updateProgress() {
  const done = currentIndex + (answered ? 1 : 0);
  document.getElementById("progressText").textContent = `${done} из ${questions.length}`;
  document.getElementById("progressBar").style.width =
    (questions.length ? done / questions.length * 100 : 0) + "%";
}

function finishTest(timeIsUp) {
  clearInterval(timerId);
  quizBox.hidden = true;
  resultBox.hidden = false;
  const percent = questions.length ? Math.round(score / questions.length * 100) : 0;

  resultBox.innerHTML = `
    <div class="alert alert-${percent >= 60 ? "success" : "warning"}">
      <h2 class="h4">Тест завершён</h2>
      <p class="mb-1">${timeIsUp ? "Время вышло. " : ""}Правильных ответов: <strong>${score} из ${questions.length}</strong>.</p>
      <p class="mb-0">Результат: <strong>${percent}%</strong>.</p>
    </div>
    <button id="restartButton" class="btn btn-primary">Пройти заново</button>`;

  document.getElementById("restartButton").addEventListener("click", () => {
    userInteracted = false;
    startTest();
  });
  document.getElementById("progressText").textContent = `${questions.length} из ${questions.length}`;
  document.getElementById("progressBar").style.width = "100%";
}

// 1. Сразу запускаем тест на встроенных вопросах — загрузка никогда не зависает.
fillTopicFilter();
startTest();
statusBox.hidden = false;
statusBox.className = "alert alert-info py-2";
statusBox.textContent = "Тест уже работает. Проверяем подключение к Google Таблице...";

// 2. Параллельно пробуем получить актуальные вопросы из Google.
// Если запрос не пройдёт, встроенный тест продолжит работать.
(async function updateFromGoogle() {
  try {
    const downloadedQuestions = await fetchGoogleQuestions();
    allQuestions = downloadedQuestions;
    fillTopicFilter();

    if (!userInteracted && resultBox.hidden) {
      startTest();
    }

    statusBox.hidden = false;
    statusBox.className = "alert alert-success py-2";
    statusBox.textContent = "Вопросы успешно загружены из Google Таблицы.";
  } catch (error) {
    console.warn("Google Таблица недоступна. Используются встроенные вопросы:", error);
    statusBox.hidden = false;
    statusBox.className = "alert alert-warning py-2";
    statusBox.textContent = "Google Таблица не загрузилась (" + error.message + "). Тест работает на встроенных вопросах.";
  }
})();

nextButton.addEventListener("click", () => {
  if (!answered) return;
  userInteracted = true;
  currentIndex++;
  showQuestion();
});

finishButton.addEventListener("click", () => finishTest(false));
topicFilter.addEventListener("change", () => {
  userInteracted = true;
  startTest();
});
