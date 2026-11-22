/* Turbopack loader for the inherited Chatdom audio: `import url from './x.wav'` becomes the public URL of that file.
 * The files are served from public/chatdom-audio (copied there once, names are unique). */
const path = require('node:path');

module.exports = function chatdomWavLoader() {
  return `export default ${JSON.stringify('/chatdom-audio/' + path.basename(this.resourcePath))};`;
};
