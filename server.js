require('dotenv').config();
const { PORT, WS_PORT } = process.env;
const app = require("./src/app");

const SyncServer = require("./src/dexie-sync");

const syncServer = new SyncServer(+WS_PORT);

syncServer.start();

app.listen(PORT, () => console.log(`App listening at http://localhost:${PORT}`))

