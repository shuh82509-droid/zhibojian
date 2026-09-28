#!/usr/bin/env bash
set -euo pipefail
qa=${1:?explicit isolated QA directory required}
case "$qa" in /home/brand-marketing/fandow-apps/fd-026222/runtime/calendar-initial-identity-20260928.*) ;; *) exit 64 ;; esac
test -d "$qa" && test ! -L "$qa"
cd "$qa"
printf '%s\n' \
 'e345f9f11ff3bd14bd6417b011e9bc584dbcb676efd2acc82d162c0257adc39c  server.js' \
 '4d1942968455c1f2ad4ed5f0a359802b3036677495cc90b441405c6efb0bf1ef  server.original.js' \
 '54271b172fdf96b903fab2187bc717244422ac02184da45ccb926cf068d95954  lifecycle-engine.mjs' \
 '5880b010e1a780dea100ab8b3447fb8603d534901df998ce8abbfa9ade4e9cf0  lifecycle-engine.original.mjs' \
 'd90bbca1858b1131dfdaa8a7d6a81c7a17f305bd51e6a912105cad755b544133  lifecycle-engine.base.mjs' \
 '55a22c5034fac65d58e66e57405d3119b068a404892e31a85733bd55b5eab6e8  oa-fallback.test.mjs' \
 'c28ebf5b3e054890bf0512dce56d11f080009ff1631030476e742d88e1f8a89e  oa-identity-readback.test.mjs' \
 '638184d5a27dd3398405fd343f5cd0e0cef591f95b321be47f29139592ff24ec  FALLBACK-INDEPENDENT-REVIEW.test.mjs' \
 'acbdbd9ff1ba1c1a0dc2339fe42e90f8cad8a950bdfc37202802ec8114cab053  initial-identity-root.test.mjs' \
 '5076d4fc9f3cfc630826bdd53f449451f76129e71baac90a3db150c59ab59891  IDENTITY-INDEPENDENT.test.mjs' | sha256sum -c -
docker --host unix:///run/user/1000/docker.sock image inspect \
 sha256:c9f28e58dbc60568307386769f9dc815267c36038fee33a89708feeb19a1af01 --format '{{.Id}}'
docker --host unix:///run/user/1000/docker.sock run --rm --entrypoint node \
 --network none --read-only --user 10001:10001 --cap-drop ALL \
 --security-opt no-new-privileges --pids-limit 96 --memory 256m --cpus 0.75 \
 --tmpfs /tmp:rw,noexec,nosuid,size=64m \
 --mount "type=bind,source=$qa,target=/qa,readonly" --workdir /qa \
 --env WIS_IDENTITY_REVIEW_ENGINE=/qa/lifecycle-engine.mjs \
 --env WIS_IDENTITY_REVIEW_SHA=54271b172fdf96b903fab2187bc717244422ac02184da45ccb926cf068d95954 \
 sha256:c9f28e58dbc60568307386769f9dc815267c36038fee33a89708feeb19a1af01 \
 --test --test-reporter=tap oa-fallback.test.mjs oa-identity-readback.test.mjs \
 FALLBACK-INDEPENDENT-REVIEW.test.mjs initial-identity-root.test.mjs IDENTITY-INDEPENDENT.test.mjs
