import { createApp } from 'vue';
import App from './App.vue';
import './style.css';

const app = createApp(App);
app.config.errorHandler = (err) => {
  (window as unknown as { __verr?: string }).__verr = String((err as Error)?.stack ?? err);
  console.error(err);
};
app.mount('#app');
