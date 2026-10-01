import { app } from "electron";
import path from "path";
import { USER_DATA_DIR_NAME } from "./identity";

// Imported first by src/main.ts, before src/config.ts opens its store and
// electron-log resolves its folder: Electron derives userData from
// productName, so renaming the app would otherwise start it with no settings
// and no sign-in. An explicit --user-data-dir still wins.
if (!app.commandLine.hasSwitch("user-data-dir")) {
  app.setPath("userData", path.join(app.getPath("appData"), USER_DATA_DIR_NAME));
}
