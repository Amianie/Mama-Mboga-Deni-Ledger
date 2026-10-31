const config = require('./src/config');
const { createApp } = require('./src/app');

createApp().then((app) => {
  app.listen(config.port, () => {
    console.log(`Mama Mboga Deni Ledger running on http://localhost:${config.port}`);
    console.log(`  Dashboard:      http://localhost:${config.port}/login`);
    console.log(`  USSD callback:  POST http://localhost:${config.port}/ussd`);
    if (!config.production) console.log(`  USSD simulator: http://localhost:${config.port}/simulator`);
    if (!config.at.apiKey) console.log('  (No AT_API_KEY set: SMS messages are printed here instead of sent)');
  });
});
