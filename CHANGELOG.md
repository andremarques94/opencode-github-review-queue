# Changelog

## [0.6.0](https://github.com/andremarques94/opencode-github-review-queue/compare/opencode-github-review-queue-v0.5.0...opencode-github-review-queue-v0.6.0) (2026-11-15)


### Features

* address the review of your own pull request from OpenCode ([#37](https://github.com/andremarques94/opencode-github-review-queue/issues/37)) ([5ce998c](https://github.com/andremarques94/opencode-github-review-queue/commit/5ce998cceb188f3ef74de68d89bf0480ac1adfb8))
* bring reviewed pull requests back to the queue when new commits arrive ([#33](https://github.com/andremarques94/opencode-github-review-queue/issues/33)) ([56fb989](https://github.com/andremarques94/opencode-github-review-queue/commit/56fb989f872eabbf8c46a48e2126478ea234a848))
* filter the queue and mark requests made to a team ([#32](https://github.com/andremarques94/opencode-github-review-queue/issues/32)) ([3cde0e6](https://github.com/andremarques94/opencode-github-review-queue/commit/3cde0e68cc02546c23928c29651605ff685efeb9))
* list your own pull requests and notify when they need you ([#36](https://github.com/andremarques94/opencode-github-review-queue/issues/36)) ([8f03962](https://github.com/andremarques94/opencode-github-review-queue/commit/8f03962c9b3eb060f3522825725179a19738aea4))
* post concrete fixes as GitHub suggestions ([#35](https://github.com/andremarques94/opencode-github-review-queue/issues/35)) ([b5771fe](https://github.com/andremarques94/opencode-github-review-queue/commit/b5771fef50496f2c55492b51a7caf46653d5b5a8))
* show how long a pull request has waited and how big it is ([#34](https://github.com/andremarques94/opencode-github-review-queue/issues/34)) ([a384a85](https://github.com/andremarques94/opencode-github-review-queue/commit/a384a852a6e0914791fc7e1f4649d8a3378a73dc))


### Bug Fixes

* show a lower bound for pull requests with over 100 review threads ([#31](https://github.com/andremarques94/opencode-github-review-queue/issues/31)) ([d574c4d](https://github.com/andremarques94/opencode-github-review-queue/commit/d574c4d5d8e2c9241179e0b0e6e1c98ab4f31231))
* show progress while summarizing and tidy the review pill ([#38](https://github.com/andremarques94/opencode-github-review-queue/issues/38)) ([407f777](https://github.com/andremarques94/opencode-github-review-queue/commit/407f777d5aa893f76bf72b4fe4eaa60bc9a123ed))

## [0.5.0](https://github.com/andremarques94/opencode-github-review-queue/compare/opencode-github-review-queue-v0.4.0...opencode-github-review-queue-v0.5.0) (2026-11-15)


### Features

* one queue poller, readiness on rows, and follow-up reviews ([#24](https://github.com/andremarques94/opencode-github-review-queue/issues/24)) ([c12d3cb](https://github.com/andremarques94/opencode-github-review-queue/commit/c12d3cb3957c59db647e186e03ad92083480411c))
* snooze pull requests until checks finish, a push, or a time ([#25](https://github.com/andremarques94/opencode-github-review-queue/issues/25)) ([8c60e57](https://github.com/andremarques94/opencode-github-review-queue/commit/8c60e57be75bf4c0c9668c448cace26c080e18b7))
* summarize a pull request on demand ([#26](https://github.com/andremarques94/opencode-github-review-queue/issues/26)) ([9b3f65b](https://github.com/andremarques94/opencode-github-review-queue/commit/9b3f65b85b9bb26949405f3ac5ec55368e927b3f))
* turn Desktop line comments into review findings ([#28](https://github.com/andremarques94/opencode-github-review-queue/issues/28)) ([fc096a7](https://github.com/andremarques94/opencode-github-review-queue/commit/fc096a70c00c64542a784a1a40b58ff5c77b7040))


### Bug Fixes

* check comment lines against the exact commits under review ([#27](https://github.com/andremarques94/opencode-github-review-queue/issues/27)) ([a04bdfd](https://github.com/andremarques94/opencode-github-review-queue/commit/a04bdfd5221bb551cc883a5f1a70eba45cafdd18))

## [0.4.0](https://github.com/andremarques94/opencode-github-review-queue/compare/opencode-github-review-queue-v0.3.0...opencode-github-review-queue-v0.4.0) (2026-11-14)


### Features

* triage review findings from the TUI and Desktop ([#22](https://github.com/andremarques94/opencode-github-review-queue/issues/22)) ([028c998](https://github.com/andremarques94/opencode-github-review-queue/commit/028c9983b9e9dc9850bed04b738c1b6e19bfb920))

## [0.3.0](https://github.com/andremarques94/opencode-github-review-queue/compare/opencode-github-review-queue-v0.2.1...opencode-github-review-queue-v0.3.0) (2026-11-14)


### Features

* review pull requests from the queue panel ([#20](https://github.com/andremarques94/opencode-github-review-queue/issues/20)) ([3102630](https://github.com/andremarques94/opencode-github-review-queue/commit/3102630fb73a61d7854e4edfdf732ac028be1047))

## [0.2.1](https://github.com/andremarques94/opencode-github-review-queue/compare/opencode-github-review-queue-v0.2.0...opencode-github-review-queue-v0.2.1) (2026-11-14)


### Bug Fixes

* discard a saved review queue that contains malformed items ([2d99894](https://github.com/andremarques94/opencode-github-review-queue/commit/2d998943e2196b6a9f7b49c098da8e6b1e94a417))

## [0.2.0](https://github.com/andremarques94/opencode-github-review-queue/compare/opencode-github-review-queue-v0.1.0...opencode-github-review-queue-v0.2.0) (2026-11-14)


### Features

* add GitHub review queue plugin ([fd0f64c](https://github.com/andremarques94/opencode-github-review-queue/commit/fd0f64c0c1e462c0fe645679125b57e5f7f621e6))
* redesign the Desktop review panel ([#12](https://github.com/andremarques94/opencode-github-review-queue/issues/12)) ([7ca70a0](https://github.com/andremarques94/opencode-github-review-queue/commit/7ca70a0afbf69526d1e95bdc1610fff03c4946f3))
* TUI mouse support and one-component-per-file layout ([#13](https://github.com/andremarques94/opencode-github-review-queue/issues/13)) ([d397dd3](https://github.com/andremarques94/opencode-github-review-queue/commit/d397dd3650cbf5c6d4b38c25fdcb0f511c2cfe0b))


### Bug Fixes

* deduplicate and compact review notifications ([#9](https://github.com/andremarques94/opencode-github-review-queue/issues/9)) ([d02d49e](https://github.com/andremarques94/opencode-github-review-queue/commit/d02d49e1684c1d1766d2359c9b467be54d33bea5))
* use relative imports so OpenCode can load the plugin ([#14](https://github.com/andremarques94/opencode-github-review-queue/issues/14)) ([ae208d1](https://github.com/andremarques94/opencode-github-review-queue/commit/ae208d1bf090e8c0a9eeb35a42b114e95132e6d7))
