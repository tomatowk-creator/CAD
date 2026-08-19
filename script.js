/**
 * ServiceNow CAD (Certified Application Developer) 模擬テスト & 学習アプリ
 * Vanilla JavaScript 実装 (URL直接組み込み・スプレッドシート自動同期版)
 */

// ==========================================
// 定数・埋め込み設定（CAD用のスプレッドシート/GAS URLに書き換えて使用してください）
// ==========================================

// config.js の設定を取得（未定義時はフォールバック）
let CSV_URL = window.CSV_URL || 'https://docs.google.com/spreadsheets/d/1b0Fyyh-t7gyf0cAvivqkdCYPJojYmdyGn8K0ny1RiYA/edit?usp=sharing';
let GAS_URL = window.GAS_URL || 'https://script.google.com/macros/s/AKfycbyQSbKkVy-NnOTxP655_UktN2LBE0xXphMIYbwLoF9Wro03EQn2wufrBDaauVPjeIPM/exec';

/** スプレッドシートの共有URLをCSV取得URLに自動変換する関数 */
function getNormalizedCsvUrl(url) {
  if (!url) return '';
  if (url.includes('/pub?') && url.includes('output=csv')) return url;
  if (url.includes('/export?format=csv')) return url;

  const match = url.match(/\/d\/([^\/]+)/);
  if (match && match[1]) {
    return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv`;
  }
  return url;
}

/**
 * @typedef {Object} Question
 * @property {string|number} id
 * @property {string} questionText
 * @property {'single'|'multi'} type
 * @property {string} category
 * @property {Object.<string, string>} options
 * @property {string[]} correctAnswers
 * @property {string} explanation
 * @property {boolean} isTagged
 */

/** 内蔵ダミーデータ (CSV取得失敗時のフォールバック) */
const DUMMY_QUESTIONS = [
  {
    id: 1,
    questionText: 'ServiceNow CAD（Certified Application Developer）のサンプル問題：Business Ruleが実行されるタイミングとして正しいものを選択してください。',
    type: 'single',
    category: 'Application Development',
    options: {
      A: 'before, after, display, async',
      B: 'before, after, onCellEdit, onLoad',
      C: 'onSubmit, onChange, onLoad, onCellEdit',
      D: 'client-side only'
    },
    correctAnswers: ['A'],
    explanation: 'Business Ruleはサーバーサイドスクリプトで、before, after, display, asyncのタイミングで実行されます。',
    isTagged: false
  },
  {
    id: 2,
    questionText: 'Script Includeの説明として正しいものを2つ選択してください。（2つ選択）',
    type: 'multi',
    category: 'Scripting',
    options: {
      A: 'サーバーサイドで再利用可能なJavaScriptクラスや関数を定義する',
      B: 'Client Callableを有効にするとGlideAjaxから呼び出し可能になる',
      C: 'フォームの見た目を動的に変更するためだけに使う',
      D: 'Update Setに保存されない'
    },
    correctAnswers: ['A', 'B'],
    explanation: 'Script Includeはサーバーサイドで再利用可能なスクリプトを定義し、Client CallableをONにすることでクライアント側のGlideAjaxから非同期呼出が可能になります。',
    isTagged: false
  }
];

// ==========================================
// グローバル状態管理
// ==========================================
const examState = {
  mode: 'exam',
  questions: [],
  currentIndex: 0,
  answers: {},
  markedForReview: {},
  checkedPractice: {},
  timeRemainingSec: 5400,
  timerId: null,
  practiceCount: '10',
  practiceOrder: 'sequential',
  practiceScope: 'all',
  selectedCategories: [],
  lastIncorrectQuestions: []
};

// ==========================================
// CSV パーサー関数
// ==========================================

function parseCorrectAnswers(rawInput) {
  if (!rawInput) return [];
  return String(rawInput)
    .split(/[,、\s]+/)
    .map(s => s.trim().toUpperCase())
    .filter(s => /^[A-H]$/.test(s));
}

function parseCSVToQuestions(csvText) {
  const lines = parseCSVLines(csvText);
  if (lines.length < 2) return [];

  const headers = lines[0].map(h => h.trim().toLowerCase());
  const questions = [];

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    if (row.length < 3 || !row[0]) continue;

    const rowObj = {};
    headers.forEach((header, index) => {
      rowObj[header] = row[index] ? row[index].trim() : '';
    });

    const options = {};
    ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].forEach(letter => {
      const key = `option_${letter}`;
      if (rowObj[key]) {
        options[letter.toUpperCase()] = rowObj[key];
      }
    });

    const correctAnswers = parseCorrectAnswers(rowObj.correct_answers || rowObj.correctAnswers);

    const isTagged = rowObj.is_tagged
      ? String(rowObj.is_tagged).toUpperCase() === 'TRUE'
      : false;

    const qText = String(rowObj.question_text || '').trim();
    // 問題文が記入されていない行はスキップ
    if (!qText) continue;

    questions.push({
      id: qId || i,
      questionText: qText,
      type: rowObj.type === 'multi' ? 'multi' : 'single',
      category: rowObj.category || '全般',
      options: options,
      correctAnswers: correctAnswers,
      explanation: rowObj.explanation || '',
      isTagged: isTagged
    });
  }

  return questions;
}

function parseCSVLines(text) {
  const result = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      row.push(cell);
      cell = '';
      if (row.some(c => c.length > 0)) {
        result.push(row);
      }
      row = [];
    } else {
      cell += char;
    }
  }

  if (cell || row.length > 0) {
    row.push(cell);
    result.push(row);
  }

  return result;
}

// ==========================================
// ユーティリティ & タグ管理 (スプレッドシート自動同期)
// ==========================================

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function isQuestionTagged(question) {
  return question ? !!question.isTagged : false;
}

async function toggleQuestionTag(question) {
  if (!question) return;

  const nextState = !question.isTagged;
  question.isTagged = nextState;

  console.log(`[Tag Toggle] Question ID: ${question.id}, New State: ${nextState}`);

  if (GAS_URL && !GAS_URL.includes('...')) {
    try {
      const action = nextState ? 'tag' : 'untag';
      const sendUrl = `${GAS_URL}?action=${action}&id=${encodeURIComponent(question.id)}`;
      console.log(`[GAS Sending] ${sendUrl}`);

      fetch(sendUrl, { mode: 'no-cors' })
        .then(() => console.log(`[GAS Success] Sent request for ID ${question.id}`))
        .catch(err => console.error('[GAS Error]', err));
    } catch (e) {
      console.error('[GAS Exception]', e);
    }
  } else {
    console.warn('[GAS Warning] GAS_URL is not set properly.');
  }

  return nextState;
}

async function loadQuestions() {
  if (!GAS_URL || GAS_URL.includes('...')) {
    console.warn('GAS_URL未設定のためダミーデータを使用します');
    updateDataStatusUI(false, DUMMY_QUESTIONS.length);
    return DUMMY_QUESTIONS;
  }

  updateDataStatusUI('loading');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 50000);

  try {
    const res = await fetch(GAS_URL, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      throw new Error('GASからのレスポンスが正しいJSON形式ではありません');
    }

    if (Array.isArray(data) && data.length > 0) {
      const parsed = parseGasDataToQuestions(data);
      updateDataStatusUI(true, parsed.length);
      return parsed;
    } else {
      updateDataStatusUI(false, DUMMY_QUESTIONS.length);
      return DUMMY_QUESTIONS;
    }
  } catch (err) {
    clearTimeout(timeoutId);
    const isTimeout = err.name === 'AbortError';
    console.warn(isTimeout ? 'GAS通信タイムアウト (50秒超過)' : 'GAS通信エラー:', err);
    updateDataStatusUI(false, DUMMY_QUESTIONS.length, isTimeout);
    return DUMMY_QUESTIONS;
  }
}

function updateDataStatusUI(status, count = 0, isTimeout = false) {
  const badge = document.getElementById('data-source-status');
  if (!badge) return;

  if (status === 'loading') {
    badge.className = 'data-status-badge loading';
    badge.innerHTML = `🔄 接続確認中... (初回は最長50秒ほどかかる場合があります)`;
  } else if (status === true) {
    badge.className = 'data-status-badge live';
    badge.innerHTML = `🟢 スプレッドシート連動中 (${count}問読み込み完了)`;
  } else {
    badge.className = 'data-status-badge dummy';
    const reasonText = isTimeout ? '通信タイムアウト(50秒)のため' : '';
    badge.innerHTML = `🟡 内蔵ダミーデータ動作中 (${count}問) ${reasonText}`;
  }
}

function parseGasDataToQuestions(rawList) {
  return rawList.map((rowObj, idx) => {
    const options = {};
    ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].forEach(letter => {
      const key = `option_${letter}`;
      if (rowObj[key] && String(rowObj[key]).trim() !== '') {
        options[letter.toUpperCase()] = String(rowObj[key]).trim();
      }
    });

    const rawCorrect = rowObj.correct_answers || rowObj.correctAnswers || '';
    const correctAnswers = parseCorrectAnswers(rawCorrect);

    const rawTagged = rowObj.is_tagged !== undefined ? rowObj.is_tagged : rowObj.isTagged;
    const isTagged = String(rawTagged).toUpperCase() === 'TRUE';

    return {
      id: rowObj.id !== undefined && rowObj.id !== '' ? rowObj.id : (idx + 1),
      questionText: rowObj.question_text || rowObj.questionText || '',
      type: (rowObj.type === 'multi') ? 'multi' : 'single',
      category: rowObj.category || '全般',
      options: options,
      correctAnswers: correctAnswers,
      explanation: rowObj.explanation || '',
      isTagged: isTagged
    };
  }).filter(q => {
    const text = String(q.questionText || '').trim();
    // 問題文が記入されている行のみを有効な問題として認識
    return text.length > 0;
  });
}

function showScreen(screenId) {
  const screens = [
    'settings-screen',
    'loading-screen',
    'exam-screen',
    'review-screen',
    'result-screen',
    'practice-result-screen'
  ];
  screens.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (id === screenId) {
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    }
  });

  if (screenId === 'settings-screen' && typeof updateModeUI === 'function') {
    updateModeUI();
  }
}

// ==========================================
// 問題描画 & 選択肢シャッフル
// ==========================================

function renderQuestion(index) {
  examState.currentIndex = index;
  const q = examState.questions[index];
  if (!q) return;

  const total = examState.questions.length;
  document.getElementById('question-progress').textContent = `Question ${index + 1} of ${total}`;
  document.getElementById('question-category').textContent = q.category || '全般';
  document.getElementById('question-text').textContent = q.questionText;

  const tagBtn = document.getElementById('btn-tag-question');
  const tagged = isQuestionTagged(q);
  tagBtn.textContent = tagged ? '★ 復習タグ設定済み' : '⭐ 要復習タグをつける';
  tagBtn.className = tagged ? 'btn-tag tagged' : 'btn-tag';

  const submitHeaderBtn = document.getElementById('btn-submit-header');
  const practiceCheckContainer = document.getElementById('practice-check-container');
  const feedbackEl = document.getElementById('practice-feedback');

  if (examState.mode === 'practice') {
    submitHeaderBtn.textContent = '終了して結果を見る';
    document.getElementById('timer-container').classList.add('hidden');
    document.getElementById('mark-review-label').classList.add('hidden');
    practiceCheckContainer.classList.remove('hidden');

    if (examState.checkedPractice[q.id]) {
      const userAns = examState.answers[q.id] || [];
      showPracticeFeedback(q, userAns);
      document.getElementById('btn-check-answer').disabled = true;
    } else {
      feedbackEl.className = 'explanation-box hidden';
      feedbackEl.innerHTML = '';
      document.getElementById('btn-check-answer').disabled = false;
    }
  } else {
    submitHeaderBtn.textContent = 'Submit Exam';
    document.getElementById('timer-container').classList.remove('hidden');
    document.getElementById('mark-review-label').classList.remove('hidden');
    practiceCheckContainer.classList.add('hidden');
    feedbackEl.className = 'explanation-box hidden';

    const markCheck = document.getElementById('mark-review-checkbox');
    markCheck.checked = !!examState.markedForReview[q.id];
  }

  const container = document.getElementById('options-container');
  container.innerHTML = '';

  const userAns = examState.answers[q.id] || [];
  const optionKeys = Object.keys(q.options);
  const shuffledKeys = shuffleArray(optionKeys);

  shuffledKeys.forEach(key => {
    const card = document.createElement('div');
    card.className = 'option-card';

    const input = document.createElement('input');
    input.type = q.type === 'single' ? 'radio' : 'checkbox';
    input.name = `question_option_${q.id}`;
    input.value = key;
    input.checked = userAns.includes(key);

    if (examState.mode === 'practice' && examState.checkedPractice[q.id]) {
      input.disabled = true;
      if (q.correctAnswers.includes(key)) {
        card.classList.add('option-correct');
      } else if (userAns.includes(key)) {
        card.classList.add('option-incorrect');
      }
    }

    input.addEventListener('change', (e) => handleOptionChange(key, e.target));

    const label = document.createElement('label');
    label.className = 'option-label';
    label.textContent = `${q.options[key]}`;
    label.addEventListener('click', (e) => {
      if (e.target !== input && !input.disabled) {
        e.preventDefault();
        input.checked = !input.checked;
        input.dispatchEvent(new Event('change'));
      }
    });

    card.appendChild(input);
    card.appendChild(label);
    container.appendChild(card);
  });

  const prevBtn = document.getElementById('btn-prev');
  const nextBtn = document.getElementById('btn-next');
  prevBtn.disabled = index === 0;

  if (examState.mode === 'practice') {
    nextBtn.textContent = '次へ';
  } else {
    nextBtn.textContent = (index === total - 1) ? 'Review画面へ' : '次へ';
  }
}

function handleOptionChange(optionKey, inputElement) {
  const q = examState.questions[examState.currentIndex];
  if (!q) return;

  let currentSelected = examState.answers[q.id] ? [...examState.answers[q.id]] : [];

  if (q.type === 'single') {
    currentSelected = [optionKey];
  } else {
    if (currentSelected.includes(optionKey)) {
      currentSelected = currentSelected.filter(k => k !== optionKey);
    } else {
      const maxAllowed = (q.correctAnswers && q.correctAnswers.length > 0) ? q.correctAnswers.length : 2;

      if (currentSelected.length >= maxAllowed) {
        alert(`選択できるのは${maxAllowed}個までです`);
        if (inputElement) {
          inputElement.checked = false;
        }
        return;
      }
      currentSelected.push(optionKey);
    }
  }

  examState.answers[q.id] = currentSelected;
}

function checkPracticeAnswer() {
  const q = examState.questions[examState.currentIndex];
  if (!q) return;

  const userAnswers = examState.answers[q.id] || [];
  if (userAnswers.length === 0) {
    alert('解答を選択してください。');
    return;
  }

  examState.checkedPractice[q.id] = true;
  showPracticeFeedback(q, userAnswers);

  document.getElementById('btn-check-answer').disabled = true;

  const inputs = document.querySelectorAll(`input[name="question_option_${q.id}"]`);
  inputs.forEach(input => {
    input.disabled = true;
    const card = input.closest('.option-card');
    if (card) {
      const key = input.value;
      if (q.correctAnswers.includes(key)) {
        card.classList.add('option-correct');
      } else if (userAnswers.includes(key)) {
        card.classList.add('option-incorrect');
      }
    }
  });
}

function showPracticeFeedback(question, userAnswers) {
  const feedbackEl = document.getElementById('practice-feedback');
  feedbackEl.classList.remove('hidden');

  const isCorrect = isAnswerCorrect(question, userAnswers);
  const expText = question.explanation || '解説は登録されていません';

  if (isCorrect) {
    feedbackEl.className = 'explanation-box correct';
    feedbackEl.innerHTML = `
      <div class="explanation-title">◯ 正解</div>
      <div>${expText}</div>
    `;
  } else {
    feedbackEl.className = 'explanation-box incorrect';
    const correctStr = question.correctAnswers.map(k => `${question.options[k] || ''}`).join(', ');
    feedbackEl.innerHTML = `
      <div class="explanation-title">× 不正解</div>
      <div style="margin-bottom: 4px;"><strong>正解:</strong> ${correctStr}</div>
      <div>${expText}</div>
    `;
  }
}

function isAnswerCorrect(q, userAnswers) {
  if (!userAnswers || userAnswers.length === 0) return false;
  if (userAnswers.length !== q.correctAnswers.length) return false;
  const sortedUser = [...userAnswers].sort();
  const sortedCorrect = [...q.correctAnswers].sort();
  return sortedUser.every((val, idx) => val === sortedCorrect[idx]);
}

function goToNext() {
  const total = examState.questions.length;
  if (examState.currentIndex < total - 1) {
    renderQuestion(examState.currentIndex + 1);
  } else {
    if (examState.mode === 'exam') {
      renderReviewScreen();
      showScreen('review-screen');
    } else {
      finishPractice();
    }
  }
}

function goToPrevious() {
  if (examState.currentIndex > 0) {
    renderQuestion(examState.currentIndex - 1);
  }
}

function toggleMarkForReview() {
  const q = examState.questions[examState.currentIndex];
  if (!q) return;
  const markCheck = document.getElementById('mark-review-checkbox');
  examState.markedForReview[q.id] = markCheck.checked;
}

function confirmGoHome(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const modal = document.getElementById('confirm-home-modal');
  if (modal) {
    modal.classList.remove('hidden');
  }
}

function closeHomeModal() {
  const modal = document.getElementById('confirm-home-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

function proceedGoHome() {
  closeHomeModal();
  stopTimer();
  showScreen('settings-screen');
}

// ==========================================
// タイマー機能
// ==========================================

function startTimer() {
  if (examState.timerId) clearInterval(examState.timerId);
  if (examState.mode !== 'exam') return;

  const timerEl = document.getElementById('timer');

  function updateDisplay() {
    const minutes = Math.floor(examState.timeRemainingSec / 60);
    const seconds = examState.timeRemainingSec % 60;
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    timerEl.textContent = `${mm}:${ss}`;

    if (examState.timeRemainingSec <= 300) {
      timerEl.classList.add('timer-warning');
    } else {
      timerEl.classList.remove('timer-warning');
    }
  }

  updateDisplay();

  examState.timerId = setInterval(() => {
    examState.timeRemainingSec--;
    if (examState.timeRemainingSec <= 0) {
      clearInterval(examState.timerId);
      examState.timerId = null;
      submitExam();
    } else {
      updateDisplay();
    }
  }, 1000);
}

function stopTimer() {
  if (examState.timerId) {
    clearInterval(examState.timerId);
    examState.timerId = null;
  }
}

// ==========================================
// Review 画面
// ==========================================

function renderReviewScreen() {
  const gridContainer = document.getElementById('review-grid');
  gridContainer.innerHTML = '';

  examState.questions.forEach((q, idx) => {
    const item = document.createElement('div');
    item.className = 'review-item';
    item.textContent = idx + 1;

    const userAns = examState.answers[q.id];
    const isAnswered = userAns && userAns.length > 0;
    const isMarked = !!examState.markedForReview[q.id];

    if (isAnswered && isMarked) {
      item.classList.add('status-answered-marked');
    } else if (isMarked) {
      item.classList.add('status-marked');
    } else if (isAnswered) {
      item.classList.add('status-answered');
    } else {
      item.classList.add('status-unanswered');
    }

    item.addEventListener('click', () => {
      showScreen('exam-screen');
      renderQuestion(idx);
    });

    gridContainer.appendChild(item);
  });
}

// ==========================================
// 採点・結果画面
// ==========================================

let examResultDetails = []; // 模試結果詳細保持

function submitExam() {
  stopTimer();

  let correctCount = 0;
  const total = examState.questions.length;
  const incorrectQuestionObjs = [];
  examResultDetails = [];

  examState.questions.forEach((q, idx) => {
    const userAns = examState.answers[q.id] || [];
    const isCorrect = isAnswerCorrect(q, userAns);
    const isMarked = !!examState.markedForReview[q.id];

    if (isCorrect) {
      correctCount++;
    } else {
      incorrectQuestionObjs.push(q);
    }

    examResultDetails.push({
      index: idx + 1,
      question: q,
      userAns: userAns,
      isCorrect: isCorrect,
      isMarked: isMarked
    });
  });

  examState.lastIncorrectQuestions = incorrectQuestionObjs;

  const percent = total > 0 ? Math.round((correctCount / total) * 100) : 0;
  const isPass = percent >= 70;

  const badge = document.getElementById('result-badge');
  badge.textContent = isPass ? 'PASS' : 'FAIL';
  badge.className = `result-badge ${isPass ? 'pass' : 'fail'}`;

  document.getElementById('score-text').textContent = `${correctCount} / ${total}`;
  document.getElementById('score-percent').textContent = `${percent}%`;

  const btnReviewExam = document.getElementById('btn-exam-review-again');
  if (btnReviewExam) {
    if (incorrectQuestionObjs.length === 0) {
      btnReviewExam.classList.add('hidden');
    } else {
      btnReviewExam.classList.remove('hidden');
    }
  }

  // 初期選択を「間違えた問題のみ」に設定
  const defaultRadio = document.getElementById('filter-incorrect');
  if (defaultRadio) defaultRadio.checked = true;

  renderExamResultList('incorrect');

  showScreen('result-screen');
}

function renderExamResultList(filterType) {
  const listEl = document.getElementById('incorrect-list');
  const headingEl = document.getElementById('result-list-heading');
  if (!listEl) return;

  listEl.innerHTML = '';

  let filteredList = [];
  if (filterType === 'all') {
    if (headingEl) headingEl.textContent = '全問題・解答と解説';
    filteredList = examResultDetails;
  } else if (filterType === 'incorrect') {
    if (headingEl) headingEl.textContent = '不正解の問題・解答と解説';
    filteredList = examResultDetails.filter(d => !d.isCorrect);
  } else if (filterType === 'correct') {
    if (headingEl) headingEl.textContent = '正解した問題・解答と解説';
    filteredList = examResultDetails.filter(d => d.isCorrect);
  } else if (filterType === 'marked') {
    if (headingEl) headingEl.textContent = 'Mark for Review の問題・解答と解説';
    filteredList = examResultDetails.filter(d => d.isMarked);
  }

  if (filteredList.length === 0) {
    listEl.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">該当する問題はありません。</p>';
    return;
  }

  filteredList.forEach(({ index, question: q, userAns, isCorrect, isMarked }) => {
    const item = document.createElement('div');
    item.className = 'incorrect-item';

    const statusBadge = isCorrect 
      ? '<span style="color: #2e7d32; font-weight: bold; margin-left: 8px;">[ ◯ 正解 ]</span>'
      : '<span style="color: #c62828; font-weight: bold; margin-left: 8px;">[ × 不正解 ]</span>';

    const markedBadge = isMarked
      ? '<span style="color: #f57f17; font-weight: bold; margin-left: 8px;">[ 🚩 Mark for Review ]</span>'
      : '';

    const userAnsStr = userAns.length > 0
      ? userAns.map(k => `${q.options[k] || ''}`).join(', ')
      : '（未回答）';
    const correctStr = q.correctAnswers.map(k => `${q.options[k] || ''}`).join(', ');

    let optionsHtml = '<div class="options-container" style="margin-top: 12px; margin-bottom: 12px;">';
    Object.keys(q.options).forEach(key => {
      let optClass = 'option-card';
      const isCorrectKey = q.correctAnswers.includes(key);
      const isUserAnsKey = userAns.includes(key);
      const inputType = q.type === 'single' ? 'radio' : 'checkbox';
      const checkedAttr = isUserAnsKey ? 'checked' : '';

      if (isCorrectKey) {
        optClass += ' option-correct';
      } else if (isUserAnsKey) {
        optClass += ' option-incorrect';
      }

      optionsHtml += `
        <div class="${optClass}" style="cursor: default;">
          <input type="${inputType}" disabled ${checkedAttr} style="margin-top: 3px; cursor: default;">
          <label class="option-label" style="cursor: default;">${q.options[key]}</label>
        </div>
      `;
    });
    optionsHtml += '</div>';

    item.innerHTML = `
      <div class="q-title">[問 ${index}] ${q.questionText} ${statusBadge} ${markedBadge}</div>
      <div class="ans-info"><strong>あなたの解答:</strong> ${userAnsStr}</div>
      <div class="ans-info"><strong>正解:</strong> ${correctStr}</div>
      ${optionsHtml}
      <div class="explanation-box ${isCorrect ? 'correct' : 'incorrect'}">
        <div class="explanation-title">解説</div>
        <div>${q.explanation || '解説は登録されていません'}</div>
      </div>
    `;
    listEl.appendChild(item);
  });
}

function retakeExam() {
  examState.answers = {};
  examState.markedForReview = {};
  examState.checkedPractice = {};
  examState.timeRemainingSec = 5400;
  showScreen('exam-screen');
  renderQuestion(0);
  startTimer();
}

function finishPractice() {
  let correctCount = 0;
  const answeredQuestions = [];
  const incorrectQuestionObjs = [];

  examState.questions.forEach(q => {
    const userAns = examState.answers[q.id] || [];
    const isAttempted = userAns.length > 0 || examState.checkedPractice[q.id];
    if (isAttempted) {
      const correct = isAnswerCorrect(q, userAns);
      if (correct) {
        correctCount++;
        if (q.isTagged) {
          toggleQuestionTag(q);
        }
      } else {
        incorrectQuestionObjs.push(q);
      }
      answeredQuestions.push({
        question: q,
        userAns: userAns,
        isCorrect: correct
      });
    }
  });

  examState.lastIncorrectQuestions = incorrectQuestionObjs;

  const totalAnswered = answeredQuestions.length;
  const percent = totalAnswered > 0 ? Math.round((correctCount / totalAnswered) * 100) : 0;

  document.getElementById('practice-score-text').textContent = `${correctCount} / ${totalAnswered}`;
  document.getElementById('practice-score-percent').textContent = `${percent}%`;

  const listEl = document.getElementById('practice-incorrect-list');
  listEl.innerHTML = '';

  const btnReviewPractice = document.getElementById('btn-practice-review-again');

  if (incorrectQuestionObjs.length === 0) {
    if (btnReviewPractice) btnReviewPractice.classList.add('hidden');
  } else {
    if (btnReviewPractice) btnReviewPractice.classList.remove('hidden');
  }

  if (totalAnswered === 0) {
    listEl.innerHTML = '<p style="text-align: center; color: #666;">解いた問題はありませんでした。</p>';
  } else {
    answeredQuestions.forEach(({ question: q, userAns, isCorrect }) => {
      const item = document.createElement('div');
      item.className = 'incorrect-item';

      const userAnsStr = userAns.length > 0
        ? userAns.map(k => `${q.options[k] || ''}`).join(', ')
        : '（未回答）';
      const correctStr = q.correctAnswers.map(k => `${q.options[k] || ''}`).join(', ');

      const statusBadge = isCorrect
        ? '<span style="color: #2e7d32; font-weight: bold; margin-left: 8px;">[ ◯ 正解 ]</span>'
        : '<span style="color: #c62828; font-weight: bold; margin-left: 8px;">[ × 不正解 ]</span>';

      item.innerHTML = `
        <div class="q-title">[問 ${q.id}] ${q.questionText} ${statusBadge}</div>
        <div class="ans-info"><strong>あなたの解答:</strong> ${userAnsStr}</div>
        <div class="ans-info"><strong>正解:</strong> ${correctStr}</div>
        <div class="explanation-box ${isCorrect ? 'correct' : 'incorrect'}">
          <div class="explanation-title">解説</div>
          <div>${q.explanation || '解説は登録されていません'}</div>
        </div>
      `;
      listEl.appendChild(item);
    });
  }

  showScreen('practice-result-screen');
}

function startReviewIncorrectSession() {
  if (!examState.lastIncorrectQuestions || examState.lastIncorrectQuestions.length === 0) {
    alert('復習対象の不正解問題はありません。');
    return;
  }

  let questionsToReview = [...examState.lastIncorrectQuestions];
  const orderRadio = document.querySelector('input[name="practice-order"]:checked');
  const order = orderRadio ? orderRadio.value : 'sequential';

  if (order === 'random') {
    questionsToReview = shuffleArray(questionsToReview);
  } else {
    questionsToReview.sort((a, b) => {
      const numA = parseFloat(a.id);
      const numB = parseFloat(b.id);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
    });
  }

  examState.mode = 'practice';
  examState.questions = questionsToReview;
  examState.currentIndex = 0;
  examState.answers = {};
  examState.markedForReview = {};
  examState.checkedPractice = {};
  examState.practiceCount = String(questionsToReview.length);

  showScreen('exam-screen');
  renderQuestion(0);
}

function updateReviewRadioState() {
  const hasTagged = (examState.questions || []).some(q => isQuestionTagged(q));
  const reviewRadio = document.getElementById('radio-scope-review');
  const msg = document.getElementById('review-no-items-msg');
  if (!reviewRadio || !msg) return;

  if (!hasTagged) {
    reviewRadio.disabled = true;
    msg.classList.remove('hidden');
    if (reviewRadio.checked) {
      const defaultAllRadio = document.querySelector('input[name="practice-scope"][value="all"]');
      if (defaultAllRadio) defaultAllRadio.checked = true;
    }
  } else {
    reviewRadio.disabled = false;
    msg.classList.add('hidden');
  }
}

function updateModeUI() {
  const modePracticeRadio = document.getElementById('mode-practice');
  const practiceOptions = document.getElementById('practice-options');
  const categorySubOptions = document.getElementById('category-select-container');
  const checkedScope = document.querySelector('input[name="practice-scope"]:checked');

  if (!practiceOptions || !modePracticeRadio) return;

  if (modePracticeRadio.checked) {
    practiceOptions.classList.remove('hidden');
    updateReviewRadioState();
    if (checkedScope && checkedScope.value === 'category') {
      if (categorySubOptions) categorySubOptions.classList.remove('hidden');
    } else {
      if (categorySubOptions) categorySubOptions.classList.add('hidden');
    }
  } else {
    practiceOptions.classList.add('hidden');
  }
}

// ==========================================
// 初期化シーケンス
// ==========================================

async function init() {
  examState.allLoadedQuestions = await loadQuestions();
  examState.questions = [...examState.allLoadedQuestions];

  const uniqueCategories = Array.from(new Set(examState.questions.map(q => q.category).filter(Boolean)));
  buildCategoryChecklist(uniqueCategories);

  const reloadBtn = document.getElementById('btn-reload-data');
  if (reloadBtn) {
    reloadBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      examState.allLoadedQuestions = await loadQuestions();
      examState.questions = [...examState.allLoadedQuestions];
      const updatedCats = Array.from(new Set(examState.questions.map(q => q.category).filter(Boolean)));
      buildCategoryChecklist(updatedCats);
    });
  }

  const modeExamRadio = document.getElementById('mode-exam');
  const modePracticeRadio = document.getElementById('mode-practice');

  modeExamRadio.addEventListener('change', updateModeUI);
  modeExamRadio.addEventListener('click', updateModeUI);
  modePracticeRadio.addEventListener('change', updateModeUI);
  modePracticeRadio.addEventListener('click', updateModeUI);

  const scopeRadios = document.querySelectorAll('input[name="practice-scope"]');
  const categorySubOptions = document.getElementById('category-select-container');

  scopeRadios.forEach(radio => {
    radio.addEventListener('change', async () => {
      if (document.querySelector('input[name="practice-scope"]:checked').value === 'category') {
        categorySubOptions.classList.remove('hidden');
        if (!examState.questions || examState.questions.length === 0) {
          examState.questions = await loadQuestions();
        }
        const cats = Array.from(new Set(examState.questions.map(q => q.category).filter(Boolean)));
        buildCategoryChecklist(cats);
      } else {
        categorySubOptions.classList.add('hidden');
      }
    });
  });

  document.getElementById('btn-tag-question').addEventListener('click', async () => {
    const q = examState.questions[examState.currentIndex];
    if (q) {
      await toggleQuestionTag(q);
      renderQuestion(examState.currentIndex);
    }
  });

  document.getElementById('btn-home-header').addEventListener('click', confirmGoHome);
  document.getElementById('btn-home-review').addEventListener('click', confirmGoHome);

  const btnCancelHome = document.getElementById('btn-cancel-home');
  if (btnCancelHome) {
    btnCancelHome.addEventListener('click', closeHomeModal);
  }
  const btnConfirmHomeYes = document.getElementById('btn-confirm-home-yes');
  if (btnConfirmHomeYes) {
    btnConfirmHomeYes.addEventListener('click', proceedGoHome);
  }

  // 初期化時に現在のUIモード状態を確実に適用
  updateModeUI();

  document.getElementById('btn-check-answer').addEventListener('click', checkPracticeAnswer);

  document.getElementById('btn-start').addEventListener('click', async () => {
    await startApp();
  });

  document.getElementById('btn-prev').addEventListener('click', goToPrevious);
  document.getElementById('btn-next').addEventListener('click', goToNext);
  document.getElementById('mark-review-checkbox').addEventListener('change', toggleMarkForReview);

  document.getElementById('btn-submit-header').addEventListener('click', () => {
    if (examState.mode === 'practice') {
      finishPractice();
    } else {
      renderReviewScreen();
      showScreen('review-screen');
    }
  });

  document.getElementById('btn-return-exam').addEventListener('click', () => {
    showScreen('exam-screen');
  });

  document.getElementById('btn-submit-final').addEventListener('click', () => {
    if (confirm('提出してよろしいですか？')) {
      submitExam();
    }
  });

  document.getElementById('btn-retake-exam').addEventListener('click', retakeExam);
  document.getElementById('btn-back-settings-1').addEventListener('click', () => showScreen('settings-screen'));
  document.getElementById('btn-back-settings-2').addEventListener('click', () => showScreen('settings-screen'));

  const btnPracticeReview = document.getElementById('btn-practice-review-again');
  if (btnPracticeReview) {
    btnPracticeReview.addEventListener('click', startReviewIncorrectSession);
  }
  const btnExamReview = document.getElementById('btn-exam-review-again');
  if (btnExamReview) {
    btnExamReview.addEventListener('click', startReviewIncorrectSession);
  }

  const resultFilterRadios = document.querySelectorAll('input[name="result-filter"]');
  resultFilterRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      renderExamResultList(e.target.value);
    });
  });
}

async function startApp() {
  showScreen('loading-screen');

  examState.mode = document.querySelector('input[name="exam-mode"]:checked').value;
  examState.practiceCount = document.querySelector('input[name="practice-count"]:checked')
    ? document.querySelector('input[name="practice-count"]:checked').value
    : '10';
  examState.practiceOrder = document.querySelector('input[name="practice-order"]:checked').value;
  examState.practiceScope = document.querySelector('input[name="practice-scope"]:checked').value;

  if (!examState.allLoadedQuestions || examState.allLoadedQuestions.length === 0) {
    examState.allLoadedQuestions = await loadQuestions();
  }

  let allQuestions = [...examState.allLoadedQuestions];

  let filtered = [...allQuestions];
  if (examState.mode === 'practice') {
    if (examState.practiceScope === 'category') {
      const selectedCats = Array.from(document.querySelectorAll('#category-checklist input:checked')).map(cb => cb.value);
      filtered = filtered.filter(q => selectedCats.includes(q.category));
    } else if (examState.practiceScope === 'review') {
      filtered = filtered.filter(q => q.isTagged);
    }

    if (examState.practiceOrder === 'random') {
      filtered = shuffleArray(filtered);
    } else {
      filtered.sort((a, b) => {
        const numA = parseFloat(a.id);
        const numB = parseFloat(b.id);
        if (!isNaN(numA) && !isNaN(numB)) {
          return numA - numB;
        }
        return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
      });
    }

    if (examState.practiceCount !== 'infinite') {
      const count = parseInt(examState.practiceCount, 10);
      if (!isNaN(count) && count > 0) {
        filtered = filtered.slice(0, count);
      }
    }
  } else {
    filtered = shuffleArray(filtered);
    if (filtered.length > 60) {
      filtered = filtered.slice(0, 60);
    }
  }

  if (filtered.length === 0) {
    alert('該当する問題がありません。設定を見直してください。');
    showScreen('settings-screen');
    return;
  }

  examState.questions = filtered;
  examState.currentIndex = 0;
  examState.answers = {};
  examState.markedForReview = {};
  examState.checkedPractice = {};
  examState.timeRemainingSec = 5400;

  showScreen('exam-screen');
  renderQuestion(0);

  if (examState.mode === 'exam') {
    startTimer();
  }
}

function buildCategoryChecklist(categories) {
  const container = document.getElementById('category-checklist');
  container.innerHTML = '';

  categories.forEach(cat => {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = cat;
    cb.checked = true;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(` ${cat}`));
    container.appendChild(label);
  });
}

document.addEventListener('DOMContentLoaded', init);
