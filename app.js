// === CPA計算ポイント学習アプリ ===

(function () {
  'use strict';

  // --- Data ---
  const ALL_CARDS = [...FINANCIAL_DATA, ...MANAGEMENT_DATA];
  const STORAGE_KEY = 'cpa_study_progress';
  const SETTINGS_KEY = 'cpa_study_settings';
  const HISTORY_KEY = 'cpa_study_history';

  // Leitner box intervals (days)
  const BOX_INTERVALS = [0, 1, 2, 4, 7, 14];

  // --- State ---
  let progress = loadProgress();
  let settings = loadSettings();
  let reviewQueue = [];
  let reviewIndex = 0;
  let reviewResults = { again: 0, ok: 0, perfect: 0 };
  let weakCards = [];

  // --- Init ---
  function init() {
    initProgress();
    bindNavigation();
    bindReview();
    bindBrowse();
    bindDashboard();
    updateHome();
    registerSW();
  }

  // --- Storage ---
  function loadProgress() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch { return {}; }
  }

  function saveProgress() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  }

  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || { dailyCards: 15 };
    } catch { return { dailyCards: 15 }; }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function loadHistory() {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY)) || {};
    } catch { return {}; }
  }

  function saveHistory(history) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }

  function initProgress() {
    ALL_CARDS.forEach(card => {
      if (!progress[card.id]) {
        progress[card.id] = { box: 1, lastReview: null, reviewCount: 0 };
      }
    });
    saveProgress();
  }

  // --- Navigation ---
  function bindNavigation() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const page = btn.dataset.page;
        showPage(page);
      });
    });
  }

  function showPage(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('page-' + page).classList.add('active');
    document.querySelector(`[data-page="${page}"]`).classList.add('active');

    if (page === 'home') updateHome();
    if (page === 'browse') renderTopicList();
    if (page === 'dashboard') renderDashboard();
  }

  // --- Home ---
  function updateHome() {
    const today = todayStr();
    const todayCards = getDailyCards();

    document.getElementById('today-count').textContent = todayCards.length;
    document.getElementById('total-cards').textContent = ALL_CARDS.length;

    let mastered = 0, weak = 0;
    ALL_CARDS.forEach(card => {
      const p = progress[card.id];
      if (p && p.box >= 5) mastered++;
      if (p && p.box <= 1 && p.reviewCount > 0) weak++;
    });
    document.getElementById('mastered-cards').textContent = mastered;
    document.getElementById('weak-cards').textContent = weak;

    // Streak
    const streak = calcStreak();
    document.getElementById('streak-count').textContent = streak;

    // Subject progress
    const finCards = ALL_CARDS.filter(c => c.subject === 'financial');
    const mgmtCards = ALL_CARDS.filter(c => c.subject === 'management');
    const finPct = calcSubjectProgress(finCards);
    const mgmtPct = calcSubjectProgress(mgmtCards);

    document.getElementById('fin-progress').style.width = finPct + '%';
    document.getElementById('fin-pct').textContent = finPct + '%';
    document.getElementById('mgmt-progress').style.width = mgmtPct + '%';
    document.getElementById('mgmt-pct').textContent = mgmtPct + '%';

    // Start review button
    document.getElementById('start-review').onclick = () => {
      reviewQueue = todayCards;
      if (reviewQueue.length === 0) {
        reviewQueue = getDailyCards(true);
      }
      if (reviewQueue.length === 0) {
        alert('全カードが学習済みです！');
        return;
      }
      startReview();
    };
  }

  function calcSubjectProgress(cards) {
    if (cards.length === 0) return 0;
    let total = 0;
    cards.forEach(card => {
      const p = progress[card.id];
      if (p) total += Math.min(p.box, 5) / 5;
    });
    return Math.round(total / cards.length * 100);
  }

  function calcStreak() {
    const history = loadHistory();
    let streak = 0;
    const d = new Date();
    // Check if studied today
    if (history[todayStr()]) {
      streak = 1;
      d.setDate(d.getDate() - 1);
    }
    while (history[dateStr(d)]) {
      streak++;
      d.setDate(d.getDate() - 1);
    }
    return streak;
  }

  // --- Daily Card Selection (Leitner) ---
  function getDailyCards(forceAll) {
    const today = new Date();
    const candidates = [];

    ALL_CARDS.forEach(card => {
      const p = progress[card.id];
      if (!p) return;

      if (forceAll) {
        candidates.push({ card, priority: Math.random() });
        return;
      }

      const interval = BOX_INTERVALS[Math.min(p.box, 5)];
      if (!p.lastReview) {
        candidates.push({ card, priority: 0 });
        return;
      }

      const last = new Date(p.lastReview);
      const daysSince = Math.floor((today - last) / (1000 * 60 * 60 * 24));
      if (daysSince >= interval) {
        candidates.push({ card, priority: p.box });
      }
    });

    // Sort: lower box first (more urgent), then random within same box
    candidates.sort((a, b) => a.priority - b.priority || Math.random() - 0.5);

    return candidates.slice(0, settings.dailyCards).map(c => c.card);
  }

  // --- Review ---
  function bindReview() {
    const cardContainer = document.getElementById('card-container');
    const flashcard = document.getElementById('flashcard');

    cardContainer.addEventListener('click', (e) => {
      // Don't flip if clicking rating buttons
      if (e.target.closest('.rating-buttons')) return;
      if (e.target.closest('.rate-btn')) return;
      flashcard.classList.toggle('flipped');
      // Show rating buttons once the card has been seen
      if (flashcard.classList.contains('flipped')) {
        document.getElementById('rating-buttons').style.display = 'flex';
      }
    });

    document.querySelectorAll('.rate-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const rating = parseInt(btn.dataset.rating);
        rateCard(rating);
      });
    });

    document.getElementById('review-back').addEventListener('click', () => {
      showPage('home');
    });

    document.getElementById('back-home-btn').addEventListener('click', () => {
      showPage('home');
    });

    document.getElementById('review-weak-btn').addEventListener('click', () => {
      reviewQueue = weakCards;
      if (reviewQueue.length > 0) startReview();
    });
  }

  function startReview() {
    reviewIndex = 0;
    reviewResults = { again: 0, ok: 0, perfect: 0 };
    weakCards = [];
    showPage('review');
    document.getElementById('review-total').textContent = reviewQueue.length;
    document.getElementById('review-complete').style.display = 'none';
    document.getElementById('card-container').style.display = 'flex';
    document.getElementById('rating-buttons').style.display = 'none';
    showCard();
  }

  function showCard() {
    if (reviewIndex >= reviewQueue.length) {
      finishReview();
      return;
    }

    const card = reviewQueue[reviewIndex];
    const flashcard = document.getElementById('flashcard');
    flashcard.classList.remove('flipped');
    document.getElementById('rating-buttons').style.display = 'none';

    document.getElementById('review-current').textContent = reviewIndex + 1;
    document.getElementById('review-subject-badge').textContent =
      card.subject === 'financial' ? '財務会計' : '管理会計';

    // Front
    document.getElementById('card-category').textContent =
      card.category + (card.subcategory ? ' > ' + card.subcategory : '');
    const rankEl = document.getElementById('card-rank');
    rankEl.textContent = card.rank;
    rankEl.className = 'card-rank rank-' + card.rank;
    document.getElementById('card-question').textContent = card.front;

    const hintEl = document.getElementById('card-hint');
    if (card.hint) {
      hintEl.textContent = card.hint;
      hintEl.classList.add('visible');
    } else {
      hintEl.classList.remove('visible');
    }

    // Back
    document.getElementById('card-category-back').textContent =
      card.category + ' > ' + card.title;
    document.getElementById('card-answer').textContent = card.back;

    // Journal entries
    const journalEl = document.getElementById('card-journal');
    if (card.journal && card.journal.length > 0) {
      let html = '<div class="card-journal-title">仕訳</div>';
      card.journal.forEach(j => {
        if (j.label) html += `<div class="journal-label">${j.label}</div>`;
        html += '<table class="journal-table"><tr><th>借方</th><th></th><th>貸方</th><th></th></tr>';
        j.entries.forEach(e => {
          const dr = e.dr || '';
          const cr = e.cr || '';
          const drAmt = e.drAmt || '';
          const crAmt = e.crAmt || '';
          html += `<tr>
            <td class="dr">${dr}</td><td class="amount">${drAmt}</td>
            <td class="cr">${cr}</td><td class="amount">${crAmt}</td>
          </tr>`;
        });
        html += '</table>';
      });
      journalEl.innerHTML = html;
      journalEl.classList.add('visible');
    } else {
      journalEl.innerHTML = '';
      journalEl.classList.remove('visible');
    }

    const formulaEl = document.getElementById('card-formula');
    if (card.formula) {
      formulaEl.textContent = card.formula;
      formulaEl.classList.add('visible');
    } else {
      formulaEl.classList.remove('visible');
    }

    const examEl = document.getElementById('card-exam-years');
    if (card.examYears && card.examYears.length > 0) {
      examEl.textContent = '出題: ' + card.examYears.join(', ');
      examEl.classList.add('visible');
    } else {
      examEl.classList.remove('visible');
    }
  }

  function rateCard(rating) {
    const card = reviewQueue[reviewIndex];
    const p = progress[card.id];

    if (rating === 1) {
      // Again - back to box 1
      p.box = 1;
      reviewResults.again++;
      weakCards.push(card);
    } else if (rating === 2) {
      // OK - stay or move up 1
      p.box = Math.min(p.box + 1, 5);
      reviewResults.ok++;
    } else {
      // Perfect - move up 2
      p.box = Math.min(p.box + 2, 5);
      reviewResults.perfect++;
    }

    p.lastReview = todayStr();
    p.reviewCount++;
    saveProgress();

    // Record history
    const history = loadHistory();
    const today = todayStr();
    history[today] = (history[today] || 0) + 1;
    saveHistory(history);

    reviewIndex++;
    showCard();
  }

  function finishReview() {
    document.getElementById('card-container').style.display = 'none';
    document.getElementById('rating-buttons').style.display = 'none';
    document.getElementById('review-complete').style.display = 'flex';

    document.getElementById('complete-again').textContent = reviewResults.again;
    document.getElementById('complete-ok').textContent = reviewResults.ok;
    document.getElementById('complete-perfect').textContent = reviewResults.perfect;

    const weakBtn = document.getElementById('review-weak-btn');
    if (weakCards.length > 0) {
      weakBtn.style.display = 'flex';
      weakBtn.querySelector && (weakBtn.textContent = `苦手カードを復習 (${weakCards.length}枚)`);
    } else {
      weakBtn.style.display = 'none';
    }
  }

  // --- Browse ---
  function bindBrowse() {
    document.getElementById('search-input').addEventListener('input', renderTopicList);

    document.querySelectorAll('.filter-btn[data-subject]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn[data-subject]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderTopicList();
      });
    });

    document.querySelectorAll('.rank-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.rank-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderTopicList();
      });
    });
  }

  function renderTopicList() {
    const search = document.getElementById('search-input').value.toLowerCase();
    const subjectFilter = document.querySelector('.filter-btn[data-subject].active').dataset.subject;
    const rankFilter = document.querySelector('.rank-filter.active').dataset.rank;

    let filtered = ALL_CARDS.filter(card => {
      if (subjectFilter !== 'all' && card.subject !== subjectFilter) return false;
      if (rankFilter === 'weak') {
        const p = progress[card.id];
        if (!p || p.box > 1 || p.reviewCount === 0) return false;
      } else if (rankFilter !== 'all' && card.rank !== rankFilter) return false;
      if (search) {
        const text = (card.category + card.subcategory + card.title + card.front + card.back + (card.tags || []).join('')).toLowerCase();
        if (!text.includes(search)) return false;
      }
      return true;
    });

    // Group by category
    const groups = {};
    filtered.forEach(card => {
      const key = card.subject + ':' + card.category;
      if (!groups[key]) {
        groups[key] = { subject: card.subject, category: card.category, cards: [] };
      }
      groups[key].cards.push(card);
    });

    const container = document.getElementById('topic-list');
    container.innerHTML = '';

    Object.values(groups).forEach(group => {
      const div = document.createElement('div');
      div.className = 'topic-group';

      const header = document.createElement('div');
      header.className = 'topic-group-header';
      header.innerHTML = `
        <span>${group.category}</span>
        <span class="topic-group-badge ${group.subject}">${group.subject === 'financial' ? '財務' : '管理'}</span>
        <span class="arrow">&#9654;</span>
      `;
      header.addEventListener('click', () => div.classList.toggle('open'));

      const cardsDiv = document.createElement('div');
      cardsDiv.className = 'topic-cards';

      group.cards.forEach(card => {
        const p = progress[card.id] || { box: 1 };
        const item = document.createElement('div');
        item.className = 'topic-card-item';
        item.innerHTML = `
          <span class="topic-card-rank rank-${card.rank}" style="background:${card.rank === 'A' ? 'var(--red)' : card.rank === 'B' ? 'var(--yellow)' : '#475569'};color:${card.rank === 'B' ? '#1e293b' : 'white'}">${card.rank}</span>
          <span>${card.title}</span>
          <span class="topic-card-box">Box ${p.box}</span>
        `;
        item.addEventListener('click', () => {
          reviewQueue = [card];
          startReview();
        });
        cardsDiv.appendChild(item);
      });

      div.appendChild(header);
      div.appendChild(cardsDiv);
      container.appendChild(div);
    });

    if (Object.keys(groups).length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">該当するカードがありません</div>';
    }
  }

  // --- Dashboard ---
  function bindDashboard() {
    document.getElementById('daily-card-count').addEventListener('change', (e) => {
      settings.dailyCards = parseInt(e.target.value);
      saveSettings();
    });

    document.getElementById('reset-btn').addEventListener('click', () => {
      if (confirm('本当に学習進捗をリセットしますか？\nこの操作は取り消せません。')) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(HISTORY_KEY);
        progress = {};
        initProgress();
        updateHome();
        alert('リセットしました');
      }
    });

    // Set initial select value
    document.getElementById('daily-card-count').value = settings.dailyCards;
  }

  function renderDashboard() {
    renderBoxChart();
    renderWeakTopics();
    renderHistoryChart();
  }

  function renderBoxChart() {
    const counts = [0, 0, 0, 0, 0, 0]; // Box 0(unused), 1-5
    ALL_CARDS.forEach(card => {
      const p = progress[card.id];
      if (p) counts[Math.min(p.box, 5)]++;
    });

    const maxCount = Math.max(...counts.slice(1), 1);
    const colors = ['', 'var(--red)', 'var(--orange)', 'var(--yellow)', 'var(--accent-light)', 'var(--green)'];
    const labels = ['', '毎日', '2日', '4日', '7日', '14日'];

    const container = document.getElementById('box-chart');
    container.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
      const wrapper = document.createElement('div');
      wrapper.className = 'box-bar-wrapper';
      const height = Math.max(counts[i] / maxCount * 80, 4);
      wrapper.innerHTML = `
        <span class="box-bar-count">${counts[i]}</span>
        <div class="box-bar" style="height:${height}px;background:${colors[i]}"></div>
        <span class="box-bar-label">Box${i}<br>${labels[i]}</span>
      `;
      container.appendChild(wrapper);
    }
  }

  function renderWeakTopics() {
    const weakList = ALL_CARDS
      .filter(card => {
        const p = progress[card.id];
        return p && p.box <= 1 && p.reviewCount > 0;
      })
      .sort((a, b) => (progress[b.id].reviewCount || 0) - (progress[a.id].reviewCount || 0))
      .slice(0, 10);

    const container = document.getElementById('weak-topics-list');
    if (weakList.length === 0) {
      container.innerHTML = '<div style="color:var(--text-muted);font-size:13px">苦手論点はまだありません</div>';
      return;
    }

    container.innerHTML = '';
    weakList.forEach((card, i) => {
      const item = document.createElement('div');
      item.className = 'weak-topic-item';
      item.innerHTML = `
        <span class="weak-topic-num">${i + 1}</span>
        <span>${card.category} > ${card.title}</span>
      `;
      item.style.cursor = 'pointer';
      item.addEventListener('click', () => {
        reviewQueue = [card];
        startReview();
      });
      container.appendChild(item);
    });
  }

  function renderHistoryChart() {
    const history = loadHistory();
    const container = document.getElementById('history-chart');
    container.innerHTML = '';

    const days = [];
    const dayLabels = ['日', '月', '火', '水', '木', '金', '土'];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push({ date: dateStr(d), label: dayLabels[d.getDay()], count: history[dateStr(d)] || 0 });
    }

    const maxCount = Math.max(...days.map(d => d.count), 1);
    days.forEach(day => {
      const wrapper = document.createElement('div');
      wrapper.className = 'history-bar-wrapper';
      const height = Math.max(day.count / maxCount * 60, 2);
      wrapper.innerHTML = `
        <div class="history-bar" style="height:${height}px;${day.count === 0 ? 'opacity:0.2' : ''}"></div>
        <span class="history-bar-label">${day.label}</span>
      `;
      container.appendChild(wrapper);
    });
  }

  // --- Utils ---
  function todayStr() { return dateStr(new Date()); }
  function dateStr(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  // --- Service Worker ---
  function registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  // --- Start ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
