# Measurement tables

All numeric cells: median [trial 1, trial 2, trial 3], milliseconds unless stated. Commands run from poc/.

Environment: {"date": "2026-09-11T09:53:43.052Z", "os": "25.6.0", "cpu": "Apple M4", "node": "v22.14.0"}; Chrome 153.0.8010.36

Command: `node bench-node.mjs`

## Node readiness

Command: `node bench-node.mjs`

|Case|Metric|Median [raw]|
|---|---|---|
|Node / esbuild-wasm|js_initialize_ms|16.577 [17.740, 16.577, 16.345]|
|Node / esbuild-wasm|wasm_ready_probe_ms|180.557 [181.588, 180.328, 180.557]|
|Node / esbuild-wasm|module_ready_ms|196.909 [199.336, 196.909, 196.908]|
|Node / esbuild-full|js_initialize_ms|16.901 [16.901, 16.739, 17.113]|
|Node / esbuild-full|wasm_ready_probe_ms|180.086 [189.608, 180.086, 177.568]|
|Node / esbuild-full|module_ready_ms|196.832 [206.519, 196.832, 194.688]|
|Node / swc-wasm|module_ready_ms|32.532 [36.010, 32.175, 32.532]|
|Node / sucrase|module_ready_ms|32.356 [45.365, 32.356, 32.215]|
|Node / babel|module_ready_ms|167.737 [171.812, 167.299, 167.737]|
|Node / oxc-native|module_ready_ms|4.679 [8.027, 4.539, 4.679]|
|Node / oxc-wasm|module_ready_ms|40.816 [49.658, 40.674, 40.816]|
|Node / rolldown-browser|module_ready_ms|93.768 [95.538, 93.768, 91.539]|

## Node incremental bundler (esbuild)

Command: `node bench-node.mjs`

|Case|Metric|Median [raw]|
|---|---|---|
|Node / esbuild-wasm|context_first_bundle_ms|54.821 [56.137, 53.562, 54.821]|
|Node / esbuild-wasm|incremental_rebuild_ms|11.118 [12.665, 10.206, 11.118]|

## Node full rebundle (esbuild / Rolldown)

Command: `node bench-node.mjs`

|Case|Metric|Median [raw]|
|---|---|---|
|Node / esbuild-full|first_full_bundle_ms|51.067 [50.205, 51.067, 54.862]|
|Node / esbuild-full|second_full_bundle_ms|13.991 [13.102, 13.991, 22.223]|
|Node / rolldown-browser|first_full_bundle_ms|102.555 [103.686, 100.799, 102.555]|
|Node / rolldown-browser|second_full_bundle_ms|51.186 [51.211, 50.372, 51.186]|

## Node transformers only

Command: `node bench-node.mjs`

|Case|Metric|Median [raw]|
|---|---|---|
|Node / swc-wasm|first_transform_all_ms|53.565 [54.229, 53.565, 53.536]|
|Node / swc-wasm|second_transform_all_ms|1.832 [1.853, 1.832, 1.727]|
|Node / sucrase|first_transform_all_ms|17.231 [17.500, 17.231, 17.069]|
|Node / sucrase|second_transform_all_ms|6.810 [7.127, 6.810, 6.651]|
|Node / babel|first_transform_all_ms|56.815 [55.621, 56.815, 64.674]|
|Node / babel|second_transform_all_ms|21.645 [20.760, 21.645, 24.497]|
|Node / oxc-native|first_transform_all_ms|0.479 [3.983, 0.479, 0.478]|
|Node / oxc-native|second_transform_all_ms|0.172 [0.171, 0.173, 0.172]|
|Node / oxc-wasm|first_transform_all_ms|20.688 [20.688, 20.979, 20.626]|
|Node / oxc-wasm|second_transform_all_ms|1.609 [1.764, 1.580, 1.609]|

Command: `node bench-browser.mjs`

## Browser readiness

Command: `node bench-browser.mjs`

|Case|Metric|Median [raw]|
|---|---|---|
|plain / esbuild-wasm|js_import_ms|3.500 [3.500, 3.900, 2.900]|
|plain / esbuild-wasm|wasm_ready_ms|41.200 [42.600, 41.200, 40.900]|
|plain / esbuild-wasm|module_ready_ms|45.100 [46.100, 45.100, 43.800]|
|plain / esbuild-full|js_import_ms|2.900 [2.900, 2.900, 3.100]|
|plain / esbuild-full|wasm_ready_ms|39.600 [39.600, 41.200, 38.000]|
|plain / esbuild-full|module_ready_ms|42.500 [42.500, 44.100, 41.100]|
|plain / swc-wasm|js_import_ms|1.800 [1.600, 1.800, 1.800]|
|plain / swc-wasm|wasm_ready_ms|28.600 [28.600, 31.700, 27.500]|
|plain / swc-wasm|module_ready_ms|30.200 [30.200, 33.500, 29.300]|
|plain / sucrase|module_ready_ms|13.200 [13.600, 13.000, 13.200]|
|plain / babel|module_ready_ms|124.400 [121.900, 124.400, 124.700]|
|plain / oxc-wasm|module_ready_ms|37.700 [38.600, 37.400, 37.700]|
|plain / rolldown-browser|errors|3/3: DataCloneError: Failed to execute 'postMessage' on 'Worker': SharedArrayBuffer transfer requires self.crossOriginIsolated.|
|iso / esbuild-wasm|js_import_ms|3.065 [3.125, 3.065, 3.040]|
|iso / esbuild-wasm|wasm_ready_ms|43.845 [40.530, 43.930, 43.845]|
|iso / esbuild-wasm|module_ready_ms|46.885 [43.660, 46.995, 46.885]|
|iso / esbuild-full|js_import_ms|3.330 [3.330, 3.125, 3.540]|
|iso / esbuild-full|wasm_ready_ms|43.985 [44.985, 43.985, 43.065]|
|iso / esbuild-full|module_ready_ms|47.115 [48.320, 47.115, 46.610]|
|iso / swc-wasm|js_import_ms|1.745 [1.920, 1.550, 1.745]|
|iso / swc-wasm|wasm_ready_ms|30.470 [30.820, 27.165, 30.470]|
|iso / swc-wasm|module_ready_ms|32.220 [32.750, 28.720, 32.220]|
|iso / sucrase|module_ready_ms|13.420 [13.420, 12.905, 13.840]|
|iso / babel|module_ready_ms|123.815 [122.770, 123.815, 126.410]|
|iso / oxc-wasm|module_ready_ms|37.945 [37.515, 37.945, 38.355]|
|iso / rolldown-browser|module_ready_ms|176.910 [176.910, 181.650, 175.145]|

## Browser incremental bundler (esbuild)

Command: `node bench-browser.mjs`

|Case|Metric|Median [raw]|
|---|---|---|
|plain / esbuild-wasm|context_first_bundle_ms|177.500 [177.500, 182.000, 176.400]|
|plain / esbuild-wasm|incremental_rebuild_ms|12.500 [12.500, 14.300, 9.900]|
|iso / esbuild-wasm|context_first_bundle_ms|187.875 [175.745, 209.745, 187.875]|
|iso / esbuild-wasm|incremental_rebuild_ms|11.380 [9.595, 12.370, 11.380]|

## Browser full rebundle (esbuild / Rolldown)

Command: `node bench-browser.mjs`

|Case|Metric|Median [raw]|
|---|---|---|
|plain / esbuild-full|first_full_bundle_ms|184.100 [180.900, 184.900, 184.100]|
|plain / esbuild-full|second_full_bundle_ms|13.000 [11.500, 13.000, 17.400]|
|plain / rolldown-browser|errors|3/3: DataCloneError: Failed to execute 'postMessage' on 'Worker': SharedArrayBuffer transfer requires self.crossOriginIsolated.|
|iso / esbuild-full|first_full_bundle_ms|176.475 [176.340, 176.475, 183.910]|
|iso / esbuild-full|second_full_bundle_ms|14.380 [14.380, 16.440, 13.295]|
|iso / rolldown-browser|first_full_bundle_ms|88.340 [89.065, 88.290, 88.340]|
|iso / rolldown-browser|second_full_bundle_ms|10.985 [11.390, 10.985, 10.260]|

## Browser transformers only

Command: `node bench-browser.mjs`

|Case|Metric|Median [raw]|
|---|---|---|
|plain / swc-wasm|first_transform_all_ms|53.600 [53.900, 53.200, 53.600]|
|plain / swc-wasm|second_transform_all_ms|1.800 [1.800, 1.800, 1.900]|
|plain / sucrase|first_transform_all_ms|11.700 [11.700, 11.400, 11.700]|
|plain / sucrase|second_transform_all_ms|3.500 [3.700, 3.300, 3.500]|
|plain / babel|first_transform_all_ms|34.900 [34.900, 34.700, 35.700]|
|plain / babel|second_transform_all_ms|10.100 [10.500, 10.000, 10.100]|
|plain / oxc-wasm|first_transform_all_ms|19.900 [20.100, 19.900, 19.900]|
|plain / oxc-wasm|second_transform_all_ms|1.600 [1.500, 1.600, 1.700]|
|iso / swc-wasm|first_transform_all_ms|53.395 [53.075, 53.395, 53.430]|
|iso / swc-wasm|second_transform_all_ms|1.775 [1.695, 1.845, 1.775]|
|iso / sucrase|first_transform_all_ms|11.715 [11.715, 11.905, 11.570]|
|iso / sucrase|second_transform_all_ms|3.445 [3.445, 3.470, 3.280]|
|iso / babel|first_transform_all_ms|35.090 [35.090, 34.535, 35.160]|
|iso / babel|second_transform_all_ms|9.925 [10.415, 9.875, 9.925]|
|iso / oxc-wasm|first_transform_all_ms|19.700 [19.700, 19.910, 19.625]|
|iso / oxc-wasm|second_transform_all_ms|1.610 [1.580, 1.610, 1.660]|

## Cross-origin iframe
Command: `node bench-browser.mjs`

|Parent COEP|Child case|Loaded trials|Child isolated trials|
|---|---|---|---|
|iso|plain|[False, False, False]|[None, None, None]|
|iso|CORP-only|[False, False, False]|[None, None, None]|
|iso|COEP|[False, False, False]|[None, None, None]|
|iso|credentialless-iframe|[True, True, True]|[False, False, False]|
|iso|COEP-allow|[False, False, False]|[None, None, None]|
|iso|COEP+CORP|[True, True, True]|[False, False, False]|
|iso|COEP+CORP+allow|[True, True, True]|[True, True, True]|
|credentialless|plain|[False, False, False]|[None, None, None]|
|credentialless|CORP-only|[False, False, False]|[None, None, None]|
|credentialless|COEP|[False, False, False]|[None, None, None]|
|credentialless|credentialless-iframe|[True, True, True]|[False, False, False]|
|credentialless|COEP-allow|[False, False, False]|[None, None, None]|
|credentialless|COEP+CORP|[True, True, True]|[False, False, False]|
|credentialless|COEP+CORP+allow|[True, True, True]|[True, True, True]|

## Installs
Command: `node bench-install.mjs`; exact per-tool argv in install-results.json.

|Manager|Cold ms median [raw]|Warm ms median [raw]|Unique generated lock hashes /3|Frozen install changed lock?|
|---|---|---|---|---|
|yarn-classic 1.22.22|1089.016 [1089.016, 1128.108, 943.615]|336.378 [318.565, 357.293, 336.378]|1|[False, False, False]|
|yarn-berry 4.18.0|1012.450 [1012.450, 1000.214, 1201.992]|419.590 [419.590, 420.818, 411.266]|1|[False, False, False]|
|pnpm 12.3.4|440.108 [440.108, 432.465, 451.632]|60.209 [60.209, 63.184, 58.595]|1|[False, False, False]|
|npm 11.4.2|911.919 [911.919, 837.063, 973.666]|386.169 [381.156, 386.169, 389.728]|1|[False, False, False]|
|bun 1.3.6|4158.416 [4158.416, 3163.001, 4185.656]|21.777 [21.962, 21.777, 20.172]|1|[False, False, False]|

## Singleton
Command: `node singleton.mjs`

|Case|Trial|React equality app/A/B|Shared QueryClient|Hook click|fetches|JS requests|
|---|---|---|---|---|---|---|
|good|1|{'appA': True, 'appB': True, 'AB': True}|True|True|1|7|
|good|2|{'appA': True, 'appB': True, 'AB': True}|True|True|1|7|
|good|3|{'appA': True, 'appB': True, 'AB': True}|True|True|1|7|
|bad|1|{'appA': True, 'appB': False, 'AB': False}|False|False|0|7|
|bad|2|{'appA': True, 'appB': False, 'AB': False}|False|False|0|7|
|bad|3|{'appA': True, 'appB': False, 'AB': False}|False|False|0|7|
