#!/usr/bin/env bash
# Builds LifeJavaTest.jar and installs it + a .desktop launcher (Exec=java -jar /abs.jar) for the current user.
set -euo pipefail
cd "$(dirname "$0")"
dest="$HOME/.local/share/life-java-test"
build="$(mktemp -d)"
trap 'rm -rf "$build"' EXIT
mkdir -p "$dest" "$HOME/.local/share/applications"
# javac/jar launchers may be missing (headless JRE package); the modules usually exist.
javac_cmd=(javac); command -v javac >/dev/null || javac_cmd=(java -m jdk.compiler/com.sun.tools.javac.Main)
jar_cmd=(jar); command -v jar >/dev/null || jar_cmd=(java -m jdk.jartool/sun.tools.jar.Main)
"${javac_cmd[@]}" -d "$build" LifeJavaTest.java
"${jar_cmd[@]}" --create --file "$dest/LifeJavaTest.jar" --main-class LifeJavaTest -C "$build" .
cat > "$HOME/.local/share/applications/life-java-test.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=LiFE Java Test
Exec=java -jar $dest/LifeJavaTest.jar
Icon=java
Categories=Utility;
DESKTOP
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
echo "Installed: $dest/LifeJavaTest.jar"
echo "Launcher:  $HOME/.local/share/applications/life-java-test.desktop"
