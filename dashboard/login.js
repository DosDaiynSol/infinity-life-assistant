import { login } from './modules/api.mjs';

const form = document.querySelector('[data-auth-login]');
const message = document.querySelector('[data-auth-message]');

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = '';

  const formData = new FormData(form);

  try {
    await login(formData.get('email'), formData.get('password'));
    window.location.replace('/');
  } catch (error) {
    message.textContent = error.message || 'Не удалось войти';
  }
});
