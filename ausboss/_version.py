"""移植版本号 = 上游 AusBoss 的版本。

上游 `nodes/_media_helpers.py` 会读自己 pyproject.toml 里的 version 给
`/ausboss/pack_version` 用，前端 `cache_guard` 拿它和 `shared/index.mjs` 里的
`AUSBOSS_JS_VERSION` 比，不一致就提示刷新缓存。

并入 Feng 之后本包没有自己的 pyproject.toml，所以版本号放这里：
**改了前端 js 就要同时改这里和 web/ausboss/shared/index.mjs 的 AUSBOSS_JS_VERSION**。
"""

PACK_VERSION = "2.24.0"

# 上游提交号，方便日后对照上游 diff（不参与运行）。
UPSTREAM_COMMIT = "431941f"
