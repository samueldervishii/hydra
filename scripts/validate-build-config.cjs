// Validate packaging settings before installer creation. Local and CI gates use
// the same checks, so configuration faults fail before installers reach users.
const fs = require("fs");
const path = require("path");

function main() {
  const projectDir = process.cwd();

  // package.json holds the complete build configuration. No schema check runs
  // because electron-builder exposes no public validator. Internal paths under
  // app-builder-lib/out/ can break on dependency updates with module-not-found
  // errors instead of configuration errors.
  const pkg = JSON.parse(
    fs.readFileSync(path.join(projectDir, "package.json"), "utf8"),
  );
  const config = pkg.build ?? {};
  console.log(
    '  \u2713 electron-builder config: read from package.json "build" (no schema check; electron-builder exposes no public validator)',
  );

  // Reject obsolete options that electron-builder can otherwise ignore.
  // Each error names the supported replacement.
  if (config.npmSkipBuildFromSource === false) {
    throw new Error(
      "npmSkipBuildFromSource is deprecated; use buildDependenciesFromSource",
    );
  }
  if (config.appImage != null && config.appImage.systemIntegration != null) {
    throw new Error(
      "appImage.systemIntegration is deprecated; use AppImageLauncher for desktop integration",
    );
  }
  if (config.extraMetadata != null) {
    if (config.extraMetadata.build != null) {
      throw new Error(
        "extraMetadata.build is deprecated; specify as -c instead",
      );
    }
    if (config.extraMetadata.directories != null) {
      throw new Error(
        "extraMetadata.directories is deprecated; specify as -c.directories instead",
      );
    }
  }
  console.log("  \u2713 no deprecated options detected");

  if (config.afterPack !== "build/afterPack.cjs") {
    throw new Error(
      "build.afterPack must use build/afterPack.cjs for macOS VMP signing",
    );
  }
  if (config.afterSign !== "build/afterSign.cjs") {
    throw new Error(
      "build.afterSign must use build/afterSign.cjs for Windows VMP signing",
    );
  }
  if (config.win?.signAndEditExecutable === false) {
    throw new Error(
      "build.win.signAndEditExecutable must not be false because Windows VMP signing depends on afterSign",
    );
  }
  console.log("  \u2713 VMP hooks: macOS afterPack, Windows afterSign");

  const nsis = config.nsis;
  if (nsis?.oneClick !== false) {
    throw new Error(
      "build.nsis.oneClick must be false to use the assisted installer",
    );
  }
  if (nsis.allowToChangeInstallationDirectory !== true) {
    throw new Error(
      "build.nsis.allowToChangeInstallationDirectory must be true",
    );
  }
  if (Object.hasOwn(nsis, "perMachine")) {
    throw new Error(
      "build.nsis.perMachine must remain unset so the installer offers per-user and all-users choices",
    );
  }
  if (Object.hasOwn(nsis, "selectPerMachineByDefault")) {
    throw new Error(
      "build.nsis.selectPerMachineByDefault must remain unset so per-user remains the default choice",
    );
  }
  if (nsis.deleteAppDataOnUninstall !== false) {
    throw new Error("build.nsis.deleteAppDataOnUninstall must remain false");
  }
  console.log(
    "  \u2713 NSIS installer: assisted, per-user by default, install scope and directory selectable",
  );

  // FPM needs a maintainer for the .deb. An explicit build.deb.maintainer
  // supplies it, which lets package.json's author carry no email address;
  // without one, electron-builder derives it from author and needs the email.
  const author = pkg.author;
  const emailRegex = /<[^>]+@[^>]+>/;
  const debMaintainer = config.deb?.maintainer;
  if (typeof debMaintainer === "string" && debMaintainer.trim() !== "") {
    console.log(`  \u2713 .deb maintainer: ${debMaintainer}`);
  } else if (typeof author === "string") {
    if (!emailRegex.test(author)) {
      throw new Error(
        "package.json 'author' must include an email (e.g. \"Name <email>\"), or set build.deb.maintainer.\n" +
          "Required for the Linux .deb maintainer field.",
      );
    }
    console.log("  \u2713 package.json author email: present");
  } else if (typeof author === "object" && author !== null) {
    if (!author.email) {
      throw new Error(
        "package.json 'author.email' must be set, or set build.deb.maintainer.\n" +
          "Required for the Linux .deb maintainer field.",
      );
    }
    console.log("  \u2713 package.json author email: present");
  } else {
    throw new Error("package.json 'author' field is missing.");
  }

  // Hydra 1.x shipped as the sidra package. Conflicts plus Replaces lets dpkg
  // swap the two, the files under /opt/Hydra they both ship included, and
  // removes sidra; Provides satisfies anything that depended on it.
  const fpm = Array.isArray(config.deb?.fpm) ? config.deb.fpm : [];
  for (const field of ["conflicts", "replaces", "provides"]) {
    const at = fpm.indexOf(`--${field}`);
    if (at === -1 || fpm[at + 1] !== "sidra") {
      throw new Error(
        `build.deb.fpm must pass --${field} sidra, so installing the hydra .deb replaces the sidra package`,
      );
    }
  }
  console.log("  \u2713 .deb replaces the sidra package: Conflicts, Replaces, Provides");

  // Ubuntu and Debian already ship a package named hydra (THC-Hydra, a network
  // login cracker), whose higher version apt offered as an upgrade over ours
  // and whose /usr/bin/hydra clashed with our link. The package and binary
  // are hydra-music. Only our own old hydra packages (<= 2.0.1) are broken
  // and replaced: an unversioned relation on hydra would block THC-Hydra.
  if (config.deb?.packageName !== "hydra-music" || config.linux?.executableName !== "hydra-music") {
    throw new Error("build.deb.packageName and build.linux.executableName must be hydra-music");
  }
  const oldHydra = "hydra (<= 2.0.1)";
  const fpmPairs = fpm.slice(0, -1).map((arg, i) => `${arg} ${fpm[i + 1]}`);
  for (const pair of [`--deb-field Breaks: ${oldHydra}`, `--replaces ${oldHydra}`]) {
    if (!fpmPairs.includes(pair)) {
      throw new Error(`build.deb.fpm must pass ${pair}`);
    }
  }
  if (fpm.some((arg) => /^hydra\b/.test(arg) && arg !== oldHydra)) {
    throw new Error("build.deb.fpm must not relate to hydra beyond our own versions <= 2.0.1");
  }
  console.log(`  \u2713 .deb is hydra-music: Breaks and Replaces ${oldHydra} only`);
  // The executable no longer matches the window class or MPRIS DesktopEntry,
  // so the desktop file keeps its own name through desktopName.
  if (pkg.desktopName !== `${pkg.name}.desktop` || config.linux?.syncDesktopName !== true) {
    throw new Error(
      `package.json desktopName must be ${pkg.name}.desktop with build.linux.syncDesktopName true, so the launcher matches the window class and MPRIS DesktopEntry`,
    );
  }
  console.log(`  \u2713 desktop file: ${pkg.desktopName}`);

  // A depends list replaces electron-builder's default instead of adding to
  // it, and that default leaves out two libraries Chromium loads at start:
  // libgbm1 for the GPU process and libasound2 for audio. A minimal system
  // lacks both, so the app installed and then failed to start. Ubuntu 24.04
  // renamed the second to libasound2t64, which provides libasound2.
  const debDepends = Array.isArray(config.deb?.depends) ? config.deb.depends : [];
  for (const lib of ["libgtk-3-0", "libnss3", "libgbm1", "libasound2"]) {
    if (!debDepends.includes(lib)) {
      throw new Error(`build.deb.depends must include ${lib}`);
    }
  }
  console.log(`  \u2713 .deb depends: ${debDepends.length} packages, libgbm1 and libasound2 included`);

  // The /usr/bin link is unregistered from prerm, while its target still
  // exists; from postrm, after dpkg has deleted the files, update-alternatives
  // warned that the link group was dangling. fpm copies the prerm untemplated,
  // so its names must match this build's executable and install folder.
  const prermPath = "build/linux/before-remove.sh";
  const prermAt = fpm.indexOf("--before-remove");
  if (prermAt === -1 || fpm[prermAt + 1] !== prermPath) {
    throw new Error(`build.deb.fpm must pass --before-remove ${prermPath}`);
  }
  const executable = config.linux?.executableName;
  const installDir = `/opt/${pkg.productName}`;
  const prerm = fs.readFileSync(path.join(__dirname, "..", prermPath), "utf8");
  for (const command of [
    `update-alternatives --remove '${executable}' '${installDir}/${executable}'`,
    `rm -f '/usr/bin/${executable}'`,
  ]) {
    if (!prerm.includes(command)) {
      throw new Error(`${prermPath} must run: ${command}`);
    }
  }
  const postrmPath = config.deb?.afterRemove;
  const postrm =
    typeof postrmPath === "string"
      ? fs.readFileSync(path.join(__dirname, "..", postrmPath), "utf8")
      : "";
  const postrmCommands = postrm
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"));
  if (!postrm || postrmCommands.some((line) => line.includes("update-alternatives"))) {
    throw new Error(
      "build.deb.afterRemove must name a postrm that leaves update-alternatives to the prerm",
    );
  }
  console.log(`  \u2713 .deb unregisters /usr/bin/${executable} from prerm, not postrm`);

  // Pin the D-Bus commands for launcher controls, not their labels.
  // Match the MPRIS integration, which names its bus after INTERNAL_NAME in
  // src/identity.ts, the package name, so a display rename leaves it alone.
  const desktop = config.linux?.desktop;
  const busName = `org.mpris.MediaPlayer2.${String(pkg.name).toLowerCase()}`;
  const actionMethods = ["PlayPause", "Next", "Previous", "Stop"];
  // Chromium sets the window class from hydra.desktop (app.setDesktopName()),
  // not from productName, so the launcher must name the same class or the
  // dock cannot tie the running window to it.
  if (desktop?.entry?.StartupWMClass !== String(pkg.name)) {
    throw new Error(
      `Linux desktop entry StartupWMClass must be "${pkg.name}", the window class`,
    );
  }
  console.log(`  \u2713 Linux desktop StartupWMClass: ${pkg.name}`);
  if (desktop?.entry?.Actions !== "PlayPause;Next;Previous;Stop;") {
    throw new Error(
      "Linux desktop entry Actions must be PlayPause;Next;Previous;Stop;",
    );
  }
  for (const method of actionMethods) {
    const action = desktop.desktopActions?.[method];
    if (action == null || typeof action !== "object") {
      throw new Error(`Linux desktop action ${method} is missing`);
    }
    if (typeof action.Name !== "string" || action.Name.trim() === "") {
      throw new Error(
        `Linux desktop action ${method}.Name must be a non-empty string`,
      );
    }
    // Match tokens so whitespace and option order can vary without accepting
    // a wrong command, destination, object path or member. The member must be
    // last because dbus-send treats later tokens as message arguments.
    const exec = typeof action.Exec === "string" ? action.Exec : "";
    const tokens = exec.split(/\s+/).filter((token) => token !== "");
    const command = tokens.shift() ?? "";
    if (command !== "dbus-send" && !command.endsWith("/dbus-send")) {
      throw new Error(`Linux desktop action ${method}.Exec must run dbus-send`);
    }
    if (!tokens.includes(`--dest=${busName}`)) {
      throw new Error(
        `Linux desktop action ${method}.Exec must target --dest=${busName}`,
      );
    }
    const operands = tokens.filter((token) => !token.startsWith("-"));
    if (operands[0] !== "/org/mpris/MediaPlayer2") {
      throw new Error(
        `Linux desktop action ${method}.Exec must use the object path /org/mpris/MediaPlayer2`,
      );
    }
    if (operands[1] !== `org.mpris.MediaPlayer2.Player.${method}`) {
      throw new Error(
        `Linux desktop action ${method}.Exec must call org.mpris.MediaPlayer2.Player.${method}`,
      );
    }
    if (
      tokens[tokens.length - 1] !== `org.mpris.MediaPlayer2.Player.${method}`
    ) {
      throw new Error(
        `Linux desktop action ${method}.Exec must end with org.mpris.MediaPlayer2.Player.${method}.\n` +
          "dbus-send stops parsing options at the member, so any later token is read as a\n" +
          "type:value message argument; a trailing flag or argument makes it exit 1 and the\n" +
          "call is never sent.",
      );
    }
  }
  console.log(`  \u2713 Linux desktop actions: wired to ${busName}`);

  // electron-builder installs every PNG from the Linux icon directory under
  // hicolor/<size>x<size>/apps. Unregistered sizes are not discoverable. The
  // directory form can provide each registered size instead of one source size.
  const registeredHicolorSizes = new Set([
    16, 22, 24, 32, 36, 48, 64, 72, 96, 128, 192, 256, 512,
  ]);
  const iconSetting = config.linux?.icon;
  if (typeof iconSetting !== "string" || iconSetting === "") {
    throw new Error("build.linux.icon must name the Linux icon set directory");
  }
  const iconDir = path.join(projectDir, iconSetting);
  if (!fs.existsSync(iconDir) || !fs.statSync(iconDir).isDirectory()) {
    throw new Error(
      `build.linux.icon must be a directory of sized PNGs, not a single file: ${iconSetting}\n` +
        "electron-builder emits one icon from a single PNG and installs it under\n" +
        "hicolor/<size>x<size>/apps, so only that one size reaches the desktop.",
    );
  }
  const iconSizes = fs
    .readdirSync(iconDir)
    .map((name) => /^(\d+)x\1\.png$/.exec(name))
    .filter((match) => match !== null)
    .map((match) => Number(match[1]));
  if (iconSizes.length === 0) {
    throw new Error(
      `build.linux.icon directory holds no <size>x<size>.png files: ${iconSetting}`,
    );
  }
  const unregistered = iconSizes
    .filter((size) => !registeredHicolorSizes.has(size))
    .sort((a, b) => a - b);
  if (unregistered.length > 0) {
    throw new Error(
      `build.linux.icon holds sizes the hicolor theme does not register: ${unregistered.join(", ")}.\n` +
        "Icons installed there are never found. Run just generate-assets.",
    );
  }
  if (!iconSizes.includes(512)) {
    throw new Error(
      "build.linux.icon must include 512x512.png, the largest registered hicolor size",
    );
  }
  console.log(
    `  \u2713 Linux icon set: ${iconSizes.sort((a, b) => a - b).join(", ")} in registered hicolor sizes`,
  );

  console.log("\nAll configuration checks passed.");
}

try {
  main();
} catch (e) {
  console.error("\n  \u2717 " + e.message);
  process.exit(1);
}
