/**
 * ui/tasks.js — the Task modal: Daily (with the points milestone bar),
 * Growth and the Lucky Month stamp card. Plus the daily-bonus claim flow.
 */

import { EVENTS } from '../game/events.js';
import { formatAmount } from '../meta/wallet.js';
import { createOverlay } from './screens.js';

const TABS = [
  { id: 'daily', labelKey: 'task.daily' },
  { id: 'growth', labelKey: 'task.growth' },
  { id: 'lucky', labelKey: 'task.lucky' },
];

/**
 * @param {object} o { el, bus, i18n, tasks, rewards, wallet, audio, onGo }
 */
export function createTaskScreen(o) {
  const { el, bus, i18n, tasks, rewards, audio } = o;
  const t = (k, v) => i18n.t(k, v);
  const overlay = createOverlay(el);
  const titleEl = el.querySelector('[data-modal="title"]');
  const tabsEl = el.querySelector('[data-modal="tabs"]');
  const bodyEl = el.querySelector('[data-modal="body"]');
  el.querySelector('[data-modal="close"]').addEventListener('click', () => {
    audio.sfx.tap();
    overlay.close();
  });

  let tab = 'daily';
  const toast = (text, kind) => bus.emit(EVENTS.TOAST, { text, kind: kind || 'info' });

  function rewardText(reward) {
    return (reward.kind === 'coins' ? formatAmount(reward.amount) : reward.amount) + '';
  }

  function rewardChip(reward) {
    const chip = document.createElement('span');
    chip.className = 'task-reward';
    chip.innerHTML =
      '<i class="cost-ico cost-ico--' + (reward.kind === 'coins' ? 'coin' : 'gem') + '"></i>' + rewardText(reward);
    return chip;
  }

  function milestoneBar() {
    const wrap = document.createElement('div');
    wrap.className = 'milestone';
    const list = tasks.milestones();
    const max = list[list.length - 1].pts;
    const pts = tasks.points;

    const head = document.createElement('div');
    head.className = 'milestone-head';
    head.innerHTML = '<span>' + t('task.milestone') + '</span><b>' + pts + '/' + max + '</b>';

    const bar = document.createElement('div');
    bar.className = 'milestone-bar';
    bar.innerHTML = '<i style="width:' + Math.min(100, Math.round((pts / max) * 100)) + '%"></i>';

    const pins = document.createElement('div');
    pins.className = 'milestone-pins';
    for (const m of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pin' + (m.claimed ? ' is-claimed' : m.reached ? ' is-ready' : '');
      b.dataset.milestone = String(m.pts);
      b.innerHTML = '<i class="cost-ico cost-ico--gem"></i>' + m.reward.amount + '<span>' + m.pts + '</span>';
      b.disabled = m.claimed || !m.reached;
      b.addEventListener('click', () => {
        const res = tasks.claimMilestone(m.pts);
        if (res.ok) {
          audio.sfx.win();
          toast('+' + res.reward.amount + ' ' + t('common.diamonds'), 'good');
        } else audio.sfx.deny();
        render();
      });
      pins.append(b);
    }

    wrap.append(head, bar, pins);
    return wrap;
  }

  function taskRow(item) {
    const row = document.createElement('div');
    row.className = 'task-row' + (item.claimed ? ' is-claimed' : item.done ? ' is-done' : '');
    row.dataset.task = item.id;

    const reward = rewardChip(item.reward);

    const meta = document.createElement('div');
    meta.className = 'task-meta';
    const title = document.createElement('span');
    title.className = 'task-title';
    title.textContent = t(item.key);
    const bar = document.createElement('span');
    bar.className = 'task-bar';
    bar.innerHTML =
      '<i style="width:' + Math.round((item.have / item.target) * 100) + '%"></i>' +
      '<b>' + item.have + '/' + item.target + '</b>';
    meta.append(title, bar);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'task-go';
    if (item.claimed) {
      btn.textContent = t('common.claimed');
      btn.disabled = true;
    } else if (item.done) {
      btn.textContent = t('common.claim');
      btn.classList.add('is-ready');
      btn.addEventListener('click', () => {
        const res = tasks.claim(item.id);
        if (res.ok) {
          audio.sfx.finish();
          toast('+' + rewardText(res.reward), 'good');
        } else audio.sfx.deny();
        render();
      });
    } else {
      btn.textContent = t('common.go');
      btn.addEventListener('click', () => {
        audio.sfx.tap();
        overlay.close();
        if (o.onGo) o.onGo(item.id);
      });
    }

    if (item.pts) {
      const pts = document.createElement('span');
      pts.className = 'task-pts';
      pts.textContent = '⚡' + item.pts;
      row.append(reward, meta, pts, btn);
    } else {
      row.append(reward, meta, btn);
    }
    return row;
  }

  function luckyCard() {
    const wrap = document.createElement('div');
    wrap.className = 'lucky';
    const info = rewards.luckyMonth();

    const head = document.createElement('p');
    head.className = 'muted';
    head.textContent = t('task.luckyInfo', { count: info.count, next: info.nextAt });

    const grid = document.createElement('div');
    grid.className = 'lucky-grid';
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const cell = document.createElement('span');
      const iso = info.month + '-' + String(d).padStart(2, '0');
      cell.className = 'lucky-day' + (info.stamps.indexOf(iso) !== -1 ? ' is-on' : '');
      cell.textContent = String(d);
      grid.append(cell);
    }

    const bonus = document.createElement('button');
    bonus.type = 'button';
    bonus.className = 'btn btn--primary btn--wide';
    const ready = rewards.canClaimDaily();
    bonus.textContent = ready
      ? t('bonus.title') + ' · ' + t('bonus.day', { day: rewards.dailyDay() })
      : t('common.claimed');
    bonus.disabled = !ready;
    bonus.addEventListener('click', () => {
      const res = rewards.claimDaily();
      if (res) {
        audio.sfx.win();
        toast(t('task.bonusGot', { day: res.day, amount: rewardText(res.prize) }), 'good');
      }
      render();
    });

    wrap.append(head, grid, bonus);
    return wrap;
  }

  function buildTabs() {
    tabsEl.textContent = '';
    for (const item of TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'modal-tab';
      b.setAttribute('role', 'tab');
      b.dataset.tab = item.id;
      b.setAttribute('aria-selected', String(item.id === tab));
      b.textContent = t(item.labelKey);
      b.addEventListener('click', () => {
        audio.sfx.tap();
        tab = item.id;
        render();
      });
      tabsEl.append(b);
    }
  }

  function render() {
    titleEl.textContent = t('task.title');
    buildTabs();
    bodyEl.textContent = '';

    if (tab === 'lucky') {
      bodyEl.append(luckyCard());
      return;
    }
    if (tab === 'daily') bodyEl.append(milestoneBar());
    for (const item of tab === 'daily' ? tasks.daily() : tasks.growth()) bodyEl.append(taskRow(item));
  }

  bus.on('tasks:progress', () => {
    if (overlay.isOpen) render();
  });

  return {
    open(startTab) {
      if (startTab) tab = startTab;
      render();
      overlay.open();
    },
    close: overlay.close,
    render,
    get isOpen() {
      return overlay.isOpen;
    },
  };
}
