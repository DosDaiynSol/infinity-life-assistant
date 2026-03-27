import { register } from './modules/api.mjs';

const form = document.querySelector('[data-auth-register]');
const message = document.querySelector('[data-auth-message]');

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = '';

  const formData = new FormData(form);
  const email = formData.get('email');
  const password = formData.get('password');
  const passwordConfirm = formData.get('passwordConfirm');

  if (password !== passwordConfirm) {
    message.textContent = 'Пароли не совпадают';
    return;
  }

  try {
    const payload = await register(email, password);
    if (payload.data?.requiresEmailConfirmation) {
      message.textContent = payload.data.message || 'Проверьте почту для подтверждения регистрации.';
      return;
    }

    window.location.replace('/');
  } catch (error) {
    message.textContent = error.message || 'Не удалось зарегистрироваться';
  }
});
