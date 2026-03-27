import { sendPasswordResetEmail } from './modules/api.mjs';

const form = document.querySelector('[data-auth-forgot]');
const message = document.querySelector('[data-auth-message]');

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = '';

  const formData = new FormData(form);

  try {
    const payload = await sendPasswordResetEmail(formData.get('email'));
    message.textContent = payload.data?.message || 'Письмо отправлено';
  } catch (error) {
    message.textContent = error.message || 'Не удалось отправить письмо';
  }
});
