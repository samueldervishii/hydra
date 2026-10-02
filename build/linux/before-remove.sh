#!/bin/bash
# prerm for the hydra .deb, passed to fpm as --before-remove through
# build.deb.fpm in package.json. fpm copies it as it is, with no templating, so
# the names are written out; scripts/validate-build-config.cjs checks them
# against executableName and productName.
#
# Unregister /usr/bin/hydra while /opt/Hydra/hydra still exists. electron-
# builder's default does this from postrm, after dpkg has deleted the files,
# so update-alternatives warned that the target was missing and the link group
# dangling. On upgrade the new package's postinst registers the same path
# again, so the link is left alone then.
case "$1" in
  remove|deconfigure)
    if type update-alternatives >/dev/null 2>&1; then
      update-alternatives --remove 'hydra' '/opt/Hydra/hydra'
    else
      rm -f '/usr/bin/hydra'
    fi
    ;;
esac

exit 0
