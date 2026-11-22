# The image the web component tests run in (`task test-component` and
# `task test-component-update`), so screenshot baselines are made and compared
# in one rendering environment on every machine and in CI.
#
# The official Playwright image's only Chinese font has no bold weight; Noto
# Sans CJK (SIL Open Font License 1.1) has every weight, so bold Chinese text
# renders as the design draws it. The font is used for test screenshots only
# and is not part of the product.
#
# The base image is pinned by tag and digest (Renovate updates both); the
# tag's Playwright version matches the playwright and @playwright/test
# packages, so the browsers are the ones those packages expect.
FROM mcr.microsoft.com/playwright:v1.65.1-noble@sha256:1507cbfc550a63a6b7396791ca4f00df17beb56342d2447b3f106c306f525579

RUN apt-get update \
  && apt-get install --yes --no-install-recommends fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/* \
  && fc-cache --force
