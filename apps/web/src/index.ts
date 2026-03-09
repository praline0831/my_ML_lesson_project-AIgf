// Web UI entry point

import { App } from './App';

const root = document.getElementById('root');
if (root) {
  root.innerHTML = '<div>Welcome to Agent Web</div>';
}

new App(root);