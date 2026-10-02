const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests',
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', launchOptions: { executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', args: ['--no-sandbox'] } } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
