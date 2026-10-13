#!/bin/sh
# Link Paula's flow files from the image into her workspace.
#
#   link-profile-files.sh <profile_dir> <workspace>
#
# `flows/`, `user_profiles/` and `USER_PROFILE.md` are not copied by the profile seeding (that only
# copies six core files, and only on a `.version` change). A link keeps them equal to the image on
# every start. A real file or folder already at a target (a hand copy) is moved aside once to
# `<name>.old-<timestamp>`. Any failure prints an error line and exits 1: the entrypoint runs under
# `set -e`, so the CM does not start with its flow files missing.
profile_dir=$1
workspace=$2

fail() {
    echo "entrypoint: error, could not link $1: $2" >&2
    exit 1
}

for name in flows user_profiles USER_PROFILE.md; do
    src="$profile_dir/$name"
    [ -e "$src" ] || continue
    dest="$workspace/$name"
    if [ -e "$dest" ] && [ ! -L "$dest" ]; then
        err=$(mv "$dest" "$dest.old-$(date +%Y%m%d%H%M%S)" 2>&1) || fail "$name" "$err"
    fi
    err=$(ln -sfn "$src" "$dest" 2>&1) || fail "$name" "$err"
done
