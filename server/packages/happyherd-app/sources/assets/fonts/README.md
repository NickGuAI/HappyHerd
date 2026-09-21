# KILV font sources

The three variable WOFF2 files and both SIL Open Font License texts are the
complete self-hosted attachments supplied in issue #287:

- Space Grotesk Latin and JetBrains Mono Greek: repository issue #287, comment 5745668285
- JetBrains Mono Latin: repository issue #287, comment 5745668425

The application loads the static TTF faces on Web, iOS, Android and Tauri via
its existing Expo font loader. These derive from the supplied WOFF2 files;
they do not require an external font service. JetBrains Mono combines both
Latin and Greek subsets. System fallback supplies scripts not present in the
attachments, including CJK. The upright faces also support the existing italic
text treatment by platform obliquing.

Rebuild the static faces with Python and `fonttools[woff]==4.60.2` installed:

```sh
python sources/assets/fonts/build-native-fonts.py
```

The converter freezes the weight axis at 400/500/600 for Space Grotesk and
400/600 for JetBrains Mono and gives each static face a distinct PostScript
name. The original license remains applicable to each generated TTF. Existing
unused IBM Plex, Bricolage and Space Mono files are retained as upstream assets,
but are no longer loaded by the application.
