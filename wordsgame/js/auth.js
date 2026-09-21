/**
 * auth.js —— 登录/注册表单逻辑
 * 导出 initAuthForm()，main.js 调用后绑定事件。
 */

import { authApi, avatarApi, setToken, setUser, clearAuth } from './api.js';

let onLoginSuccess = null;

export function initAuthForm(callbacks = {}) {
  onLoginSuccess = callbacks.onLoginSuccess || (() => {});

  const loginForm   = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const loginMsg    = document.getElementById('login-msg');
  const registerMsg = document.getElementById('register-msg');

  // 表单切换
  document.querySelectorAll('[data-switch]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const target = a.dataset.switch;
      if (target === 'register') {
        loginForm.classList.remove('active');
        registerForm.classList.add('active');
      } else {
        registerForm.classList.remove('active');
        loginForm.classList.add('active');
      }
      loginMsg.textContent = ''; loginMsg.className = 'form-msg';
      registerMsg.textContent = ''; registerMsg.className = 'form-msg';
    });
  });

  // 登录
  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(loginForm);
    const body = {
      username: fd.get('account'),
      password: fd.get('password'),
    };
    setMsg(loginMsg, '登录中...', '');
    try {
      const data = await authApi.login(body);
      setToken(data.token);
      setUser(data.user);
      setMsg(loginMsg, '登录成功！', 'success');
      onLoginSuccess(data.user);
    } catch (err) {
      setMsg(loginMsg, err.message || '登录失败', 'error');
    }
  });

  // 注册
  registerForm.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(registerForm);
    const pw = String(fd.get('password') || '');
    const pw2 = String(fd.get('password2') || '');
    if (pw !== pw2) {
      setMsg(registerMsg, '两次密码不一致', 'error'); return;
    }
    const body = {
      username: fd.get('username'),
      email: fd.get('email'),
      password: pw,
      nickname: fd.get('nickname') || '',
      gender: fd.get('gender') || 'other',
      avatar: getSelectedAvatar() || '',
    };
    setMsg(registerMsg, '注册中...', '');
    try {
      const data = await authApi.register(body);
      setToken(data.token);
      setUser(data.user);
      setMsg(registerMsg, '注册成功！正在进入游戏...', 'success');
      onLoginSuccess(data.user);
    } catch (err) {
      setMsg(registerMsg, err.message || '注册失败', 'error');
    }
  });

  // 加载默认头像选项
  loadAvatarOptions();
}

function setMsg(el, text, cls) {
  el.textContent = text;
  el.className = 'form-msg' + (cls ? ' ' + cls : '');
}

// 头像选择器
let selectedAvatarUrl = '';
async function loadAvatarOptions() {
  const picker = document.getElementById('avatar-picker');
  if (!picker) return;
  picker.innerHTML = '';
  try {
    const avatars = await avatarApi.defaults();
    avatars.forEach((a, idx) => {
      const div = document.createElement('div');
      div.className = 'avatar-option';
      div.innerHTML = `<img src="${a.url}" alt="${a.label}">`;
      div.title = a.label;
      if (idx === 0) div.classList.add('selected');
      div.addEventListener('click', () => {
        picker.querySelectorAll('.avatar-option').forEach(x => x.classList.remove('selected'));
        div.classList.add('selected');
        selectedAvatarUrl = a.url;
      });
      picker.appendChild(div);
      if (idx === 0) selectedAvatarUrl = a.url;
    });
  } catch (err) {
    // 就算头像接口挂了也要给点默认
    picker.innerHTML = '<div class="avatar-option selected" title="默认">👤</div>';
    selectedAvatarUrl = '';
  }
}

function getSelectedAvatar() { return selectedAvatarUrl; }

// 退出登录
export function logout() {
  clearAuth();
}

// 检查登录态（刷新时）
export function checkAuth() {
  const token = localStorage.getItem('wordsgame_token');
  const user  = localStorage.getItem('wordsgame_user');
  return !!(token && user);
}
