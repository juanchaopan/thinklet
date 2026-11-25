# The image the web component tests run in (`task test-component` and
# `task test-component-update`), so screenshot baselines are made and compared
# in one rendering environment on every machine and in CI.
#
# The official Playwright image's only Chinese font has no bold weight. Noto
# Sans CJK SC (SIL Open Font License 1.1), the family the web's font stack
# names, has every weight from Thin to Black, so bold Chinese text renders as
# the design draws it. The font comes from a fixed release of Noto CJK on
# GitHub (notofonts/noto-cjk): the build downloads the release's Simplified
# Chinese OTF archive, stops unless its SHA-256 is the one below, and
# installs the fonts with their license into the system font directory. A
# new release means a new version, URL and hash here, and new screenshot
# baselines. The font is used for test screenshots only and is not part of
# the product.
#
# The base image is pinned by tag and digest (Renovate updates both); the
# tag's Playwright version matches the playwright and @playwright/test
# packages, so the browsers are the ones those packages expect.
FROM mcr.microsoft.com/playwright:v1.65.1-noble@sha256:1507cbfc550a63a6b7396791ca4f00df17beb56342d2447b3f106c306f525579

ARG NOTO_CJK_VERSION=Sans2.004
ARG NOTO_CJK_URL=https://github.com/notofonts/noto-cjk/releases/download/${NOTO_CJK_VERSION}/08_NotoSansCJKsc.zip
ARG NOTO_CJK_SHA256=a927e56f53bd6c3b920bc139c0b94aa36c7d9ad0cf009b159437a1a003581140
ARG FONT_DIRECTORY=/usr/local/share/fonts/noto-sans-cjk-sc

# The image has curl and Python but no unzip, so Python's zipfile module
# unpacks the archive.
RUN curl --fail --silent --show-error --location --retry 3 \
    --output /tmp/noto-sans-cjk-sc.zip "$NOTO_CJK_URL" \
  && echo "$NOTO_CJK_SHA256  /tmp/noto-sans-cjk-sc.zip" | sha256sum --check --strict \
  && mkdir -p "$FONT_DIRECTORY" \
  && python3 -I -m zipfile -e /tmp/noto-sans-cjk-sc.zip "$FONT_DIRECTORY" \
  && rm /tmp/noto-sans-cjk-sc.zip \
  && fc-cache --force
