import { resetPassword } from './modules/api.mjs';

const form = document.querySelector('[data-auth-reset]');
const message = document.querySelector('[data-auth-message]');

function getRecoveryTokens() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return {
    accessToken: hash.get('access_token') || '',
    refreshToken: hash.get('refresh_token') || ''
  };
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = '';

  const formData = new FormData(form);
  const password = formData.get('password');
  const passwordConfirm = formData.get('passwordConfirm');

  if (password !== passwordConfirm) {
    message.textContent = 'Пароли не совпадают';
    return;
  }

  const tokens = getRecoveryTokens();

  try {
    await resetPassword({
      ...tokens,
      password
    });
    message.textContent = 'Пароль обновлен. Сейчас перенаправим вас в кабинет.';
    window.setTimeout(() => {
      window.location.replace('/');
    }, 1200);
  } catch (error) {
    message.textContent = error.message || 'Не удалось обновить пароль';
  }
});
