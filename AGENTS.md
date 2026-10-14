# Open Roberta Lab — Agent Guide

Technical guide to **Open Roberta Lab** (`openroberta-lab`): repository layout, build/test commands, architecture (Web UI ↔ AST/codegen ↔ simulation ↔ cross-compilers), all 37 robot plugins, and development playbooks.

---

## 1. Repository & Module Structure

Multi-module **Maven (Java 11) + TypeScript/Gulp** monorepo:

```text
openroberta-lab/
├── pom.xml                       # Root POM
├── ora.sh / admin.sh             # Scripts to start server, manage DB, run generators
├── OpenRobertaRobot/             # Core framework: AST, @Nepo* annotations, base visitors/workers, RobotFactory, C.java
├── OpenRobertaServer/            # Embedded Jetty, REST endpoints, Hibernate/HSQLDB, staticResources/
│   ├── src/main/resources/openRoberta.properties # Server config & robot.whitelist
│   └── staticResources/          # Served by Jetty (app/scss/ source; blockly/ pre-built; css/ & js/ GENERATED)
├── OpenRobertaWeb/               # Frontend TS/JS source & Gulp pipeline (package.json, tsconfig.json, gulpfile.js)
│   └── src/
│       ├── main.js               # RequireJS module paths & bootstrap
│       └── app/
│           ├── roberta/          # UI controllers (progSim, progCode, guistate, connections/connections.ts)
│           ├── nepostackmachine/ # Bytecode interpreter (interpreter.interpreter.ts, interpreter.robotSimBehaviour.ts, interpreter.constants.ts)
│           ├── simulation/       # 2D Canvas & Webots sim (simulation.scene.ts, robot.<group>.ts, robot.actuators.ts, robot.sensors.ts)
│           ├── configVisualization/ # Visual pin/port config UI (confVisualization.ts, robots.xml)
│           └── neuralnetwork/    # xNN neural network tab
└── Robot*/                       # Robot plugin Maven modules (37 plugins across 12 modules)
    ├── RobotArdu/                # uno, nano, mega, unowifirev2, nano33ble, mbot, botnroll, bob3, rob3rta, sensebox, festobionic, festobionicflower
    ├── RobotCyberpi/             # mbot2
    ├── RobotEdison/              # edisonv2, edisonv3
    ├── RobotEV3/                 # ev3lejosv1, ev3lejosv0, ev3dev, ev3c4ev3, xNN
    ├── RobotFischertechnik/      # txt4
    ├── RobotMbed/                # calliope2016, calliope2017, calliope2017NoBlue, calliopev3, microbit, microbitv2, joycar
    ├── RobotNAO/                 # nao
    ├── RobotNXT/                 # nxt
    ├── RobotRobotino/            # robotino, robotinoROS
    ├── RobotSpike/               # spike, spikePybricks, rcj
    ├── RobotThymio/              # thymio
    └── RobotWeDo/                # wedo
```

- **Module Dependencies**: `OpenRobertaRobot` has no `Robot*` dependencies. Each `Robot*` module depends **only** on `OpenRobertaRobot` (plus `test-jar` in test scope). `OpenRobertaServer` depends on `OpenRobertaRobot` and **all `Robot*` modules**.

---

## 2. Build, Test, and Run Commands

### Backend (Maven / Java 11)
- **Full build (skip tests)**: `mvn clean install -DskipTests`
- **Unit tests (single module / single test, e.g. for Spike)**:
  `mvn test -pl RobotSpike` or `mvn test -pl RobotSpike -Dtest=SpikeStackMachineVisitorTest`
- **Integration tests (cross-compilers & full plugin tests)**: `mvn test -PrunIT`
- **Start server locally** (`http://localhost:1999`):
  ```bash
  ./ora.sh -oraccrsc ../ora-cc-rsc start-from-git
  ```
  - **Cross-compiler resources (`ora-cc-rsc`)**: Hardware compilation requires [`ora-cc-rsc`](https://github.com/OpenRoberta/ora-cc-rsc) cloned next to `openroberta-lab` (default `../ora-cc-rsc`, or `-oraccrsc <path>`).
    - `spikePybricks` does **not** require building `ora-cc-rsc` with Maven (`RobotSpike/compile.py` is tracked in git).
    - If `mvn clean install` in `ora-cc-rsc` fails with `401 Unauthorized` on Fraunhofer Artifactory, run `mvn clean install -Dmdep.skip=true`.
  - **`mpy-cross-v6` for `spikePybricks`**: `ora-cc-rsc/RobotSpike/compile.py` invokes `mpy-cross-v6` to compile Python to `.mpy` bytecode. On Debian/PEP 668 Linux, `apt` `micropython` lacks `mpy-cross-v6`; install via `sudo apt install pipx && pipx install mpy-cross-v6 && pipx ensurepath`.

### Frontend (`OpenRobertaWeb`)
- **Install dependencies**: `npm --prefix OpenRobertaWeb install`
- **Build & minify (REQUIRED before committing frontend changes)**: `npx --prefix OpenRobertaWeb gulp`
- **Fast type-check (dev only, writes UNMINIFIED JS)**: `npm --prefix OpenRobertaWeb run build` *(always run `npx gulp` afterwards)*
- **Format frontend code (only upon EXPLICIT user request)**: `npm --prefix OpenRobertaWeb run format`

---

## 3. End-to-End Architecture

### 3.1 Plugin Discovery & `.properties` Inheritance
1. `ServerStarter` reads `robot.whitelist` in `OpenRobertaServer/src/main/resources/openRoberta.properties` and loads `classpath:/<plugin>.properties`.
2. `.properties` files support recursive `#include classpath:/<base>.properties` at the top. Base templates: `arduino.properties` (`RobotArdu`), `calliope.properties` & `microbitCommon.properties` (`RobotMbed`), `edison.properties` (`RobotEdison`), `ev3.properties` (`RobotEV3`).
3. `RobotFactory` scans `de.fhg.iais.roberta.syntax` for `@NepoPhrase`, `@NepoExpr`, `@NepoBasic`, and `@NepoConfiguration` AST classes and `IWorker` implementations.
4. On `/init`, the server sends plugin metadata (`group`, `pluginSim`, extensions, toolbox/conf XML) to `guistate.controller.ts`.

### 3.2 Blockly XML → AST → Workflows & Visitors
`/projectWorkflow/*` calls `ProjectService.executeWorkflow(workflowName, project)`, running the comma-separated `IWorker` pipeline in `robot.plugin.workflow.<workflowName>`:
- `showsource`: `validate.and.collect[,typecheck],generate,regenerateNepo` → target code (`py`/`cpp`/`java`/`nxc`/`aesl`/`json`).
- `getsimulationcode`: `validate.and.collect.sim[,typecheck],generatesimulation,regenerateNepo` → stack-machine JSON (`opCodes`) via `*StackMachineVisitor` (`do.nothing` if unsupported).
- `compile` / `run`: `validate.and.collect[,typecheck],generate,compile[,transfer],regenerateNepo`.
- `compilenative` / `runnative`: `compilenative[,transfer]` (compiles raw user-edited code without AST).

**Visitor Pipeline (`IVisitor`)**:
1. `*ValidatorAndCollectorVisitor`: Validates ports/configs/sim support; populates `UsedHardwareBean` & `UsedMethodBean`.
2. `*TypecheckVisitor` (optional): Checks expression types.
3. `*<Lang>Visitor` (`*PythonVisitor`, `*CxxVisitor`, `*JavaVisitor`, `*AsebaVisitor`): Emits target source to `Project.setSourceCode(...)`.
4. `*StackMachineVisitor` (extends `AbstractStackMachineVisitor`): Emits sim JSON bytecode to `Project.setSimProgram(...)`.

### 3.3 Simulation Pipeline (Backend ↔ Stack Machine ↔ 2D Canvas / Webots)
1. **Shared Constants**: `C.java` (backend) and `interpreter.constants.ts` + `simulationLogic/constants.js` (frontend) must share identical strings for opcodes, sensors (`TOUCH`, `COLOR`, `ULTRASONIC`), modes (`PRESSED`, `FORCE`, `DISTANCE`), and actions.
2. **Interpreter (`nepostackmachine/`)**: `interpreter.interpreter.ts` executes bytecode and calls `interpreter.robotSimBehaviour.ts`:
   - `getSample(...)`: Reads `this.hardwareState.sensors[port][sensorType][mode]` (note: `mode` is lowercased on entry, e.g. `'FORCE'` → `'force'`).
   - Actuator actions write to `this.hardwareState.actions.<actuator>`.
3. **2D Scene (`simulation/simulationLogic/`)**:
   - Resolves robot module via `const robotType = GUISTATE_C.getPluginSim() || GUISTATE_C.getRobotGroup()`, loading `robot.<robotType.toLowerCase()>.ts`.
   - `robot.<type>.ts` extends `RobotBaseMobile` or `RobotBaseStationary` and implements `configure(config)` to attach actuators (`robot.actuators.ts`) and sensors (`robot.sensors.ts`).
   - Sensors implement `updateSensor(...)` (writes `uState[this.port][sensorType][mode]`), `draw(...)`, and `getLabel()` (renders `#simValuesModal` HTML using `Blockly.Msg.SENSOR_*` and `Blockly.Msg['LISTS_IS_EMPTY_TITLE_' + val.toString().toUpperCase()]` for localized booleans).
   - NAO uses Webots 3D (`simulation.webots.ts`, `robot.plugin.webots.sim = true`).

### 3.4 Hardware Connections (`connections.ts`) & Compilers (`ora-cc-rsc`)
1. **`TokenConnection`**: (`ev3lejosv1`, `ev3dev`, `xNN`, `nxt`, `nao`, `mbot2`, `spike`, `txt4`, `robotino`, `uno`, `nano`, `mega`, `nano33ble`, `mbot`, `festobionic*`). Backend compiles/saves to `robot.crosscompiler.tempdir` and `TransferWorker` queues it in `RobotCommunicator` for `/pushcmd` & `/download`.
2. **`AgentOrTokenConnection`**: (`bob3`, `rob3rta`, `botnroll`). `ArduinoCompilerWorker` (`avr-gcc`) + `TransferWorker` / `NIBOTransferWorker`.
3. **`AutoConnection` (WebUSB DAPLink / File Download)**: (`calliope*`, `microbit*`, `joycar`, `sensebox`, `ev3c4ev3`). Compiler worker returns `compiledCode` (`.hex`/`.bin`/`.uf2`) to browser for WebUSB (`dapjs`) or USB drive download.
4. **`SpikePybricksWebBleConnection`**: (`spikePybricks`). `SpikePybricksCompilerWorker` runs `ora-cc-rsc/RobotSpike/compile.py` (`mpy-cross-v6`) → base64 `.mpy` flashed in browser over WebBluetooth GATT.
5. **External API / Local WebSocket**: `edisonv2`/`v3` (`EdisonConnection` calls `api.edwareapp.com` for `.wav`); `thymio` (`ThymioDeviceManagerConnection` sends `.aesl` over `ws://localhost:8597`).
6. **`WebViewConnection`**: (`wedo`). `WedoCodeGeneratorWorker` emits stack-machine JSON executed client-side via `Interpreter` + `RobotWeDoBehaviour` over BLE bridge.

---

## 4. Supported Robot Platforms (37 Plugins)

*(All active in `robot.whitelist` except `unowifirev2`, `ev3lejosv0`, `robotinoROS`. Worker names abbreviated: `Gen` = GeneratorWorker, `Sim` = StackMachineGeneratorWorker, `Comp` = CompilerWorker.)*

| Module | Plugin(s) | Group (`pluginSim`) | Ext | Conf | Simulation (`robot.<type>.ts`) | Generator & Sim Workers | Compiler / Save Worker (`ora-cc-rsc`) | Connection (`connections.ts`) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `RobotArdu` | `uno`, `nano`, `mega`, `unowifirev2`* | `arduino` | `cpp`/`hex` | `new` | No | `ArduinoCxxGen` | `ArduinoComp` (`avr-gcc`) + `TransferWorker` | `TokenConnection` |
| `RobotArdu` | `nano33ble` | `nano33ble` | `cpp`/`bin` | `new` | No | `Nano33bleCxxGen` | `ArduinoComp` (`arm-none-eabi-g++`) + `TransferWorker` | `TokenConnection` |
| `RobotArdu` | `mbot` | `mbot` | `cpp`/`hex` | `old-P` | `robot.mbot.ts` (multisim) | `MbotCxxGen`, `MbotSim` | `ArduinoComp` (`avr-gcc`) + `TransferWorker` | `TokenConnection` |
| `RobotArdu` | `botnroll` | `botnroll` | `cpp`/`hex` | `old-S` | No | `BotnrollCxxGen` | `ArduinoComp` (`avr-gcc`) + `TransferWorker` | `AgentOrTokenConnection` |
| `RobotArdu` | `bob3` | `bob3` | `cpp`/`hex` | fixed | No | `Bob3CxxGen` | `ArduinoComp` (`avr-gcc` + `NIBOHexPrefix`) + `NIBOTransferWorker` | `AgentOrTokenConnection` |
| `RobotArdu` | `rob3rta` | `rob3rta` | `cpp`/`hex` | fixed | `robot.rob3rta.ts` | `Rob3rtaCxxGen`, `Rob3rtaSim` | `ArduinoComp` (`avr-gcc` + `NIBOHexPrefix`) + `NIBOTransferWorker` | `AgentOrTokenConnection` |
| `RobotArdu` | `sensebox` | `sensebox` | `cpp`/`bin` | `new` | No | `SenseboxCxxGen` | `ArduinoComp` (`arm-none-eabi-g++` SAMD21) | `AutoConnection` |
| `RobotArdu` | `festobionic`, `festobionicflower` | `festobionic*` | `cpp`/`zip` | `new` | No | `Festobionic*CxxGen` | `ArduinoComp` (ESP32 zip) + `TransferWorker` | `TokenConnection` |
| `RobotCyberpi` | `mbot2` | `mbot2` | `py`/`py` | `new` | No | `Mbot2PythonGen` | `SaveWorker` + `TransferWorker` | `TokenConnection` |
| `RobotEdison` | `edisonv2`, `edisonv3` | `edison` | `py`/`wav` | fixed | `robot.edison.ts` (multisim) | `EdisonPythonGen`, `EdisonSim` | `EdisonComp` (browser fetches `.wav` from EdPy API) | `EdisonConnection` |
| `RobotEV3` | `ev3lejosv1` (default), `ev3lejosv0`* | `ev3` | `java`/`jar` | `old-S` | `robot.ev3.ts` (multisim) | `Ev3JavaGen`, `Ev3Sim` | `Ev3LejosComp` (`JavaCompiler`) + `TransferWorker` | `TokenConnection` |
| `RobotEV3` | `ev3dev` | `ev3` | `py`/`py` | `old-S` | `robot.ev3.ts` (multisim) | `Ev3PythonGen`, `Ev3Sim` | `SaveWorker` + `TransferWorker` | `TokenConnection` |
| `RobotEV3` | `ev3c4ev3` | `ev3` | `cpp`/`uf2` | `old-S` | `robot.ev3.ts` (multisim) | `Ev3CxxGen`, `Ev3Sim` | `Ev3C4ev3Comp` (`arm-linux-gnueabi-g++` + `Uf2Builder`) | `AutoConnection` |
| `RobotEV3` | `xNN` | `xNN` | `java`/`jar` | `old-S` | `robot.xnn.ts` (multisim) | `Ev3JavaGen`, `Ev3Sim` | `Ev3LejosComp` + `TransferWorker` | `TokenConnection` |
| `RobotFischertechnik` | `txt4` | `txt4` | `py`/`ft` | `new` | `robot.txt4.ts` (multisim) | `Txt4PythonGen`, `Txt4Sim` | `Txt4SaveWorker` (zips `.py` + lib) + `TransferWorker` | `TokenConnection` |
| `RobotMbed` | `calliope2016`, `2017`, `2017NoBlue` | `calliope` | `cpp`/`hex` | `new` | `robot.calliope.ts` | `CalliopeCxxGen`, `CalliopeSim` | `CalliopeComp` (`arm-none-eabi-g++` + `srec_cat`) | `AutoConnection` (WebUSB) |
| `RobotMbed` | `calliopev3` | `calliope` (`calliopeV3`) | `py`/`hex` | `new` | `robot.calliopev3.ts` | `CalliopeV3PythonGen`, `CalliopeV3Sim` | `CalliopeV3Comp` (`compile.py` MicroPython hex merge) | `AutoConnection` (WebUSB) |
| `RobotMbed` | `microbit` | `microbit` | `py`/`hex` | `new` | `robot.microbit.ts` | `MicrobitPythonGen`, `MicrobitSim` | `MicrobitV1Comp` (`compile.py` MicroPython hex merge) | `AutoConnection` (WebUSB) |
| `RobotMbed` | `microbitv2` | `microbitv2` | `py`/`hex` | `new` | `robot.microbitv2.ts` | `MicrobitV2PythonGen`, `MicrobitV2Sim` | `MicrobitV2Comp` (`compile.py` MicroPython V2 hex merge) | `AutoConnection` (WebUSB) |
| `RobotMbed` | `joycar` | `joycar` | `py`/`hex` | `new` | No | `JoyCarPythonGen` | `MicrobitV2Comp` (`compile.py` MicroPython V2 hex merge) | `AutoConnection` (WebUSB) |
| `RobotNAO` | `nao` | `nao` | `py`/`py` | fixed | Webots (`simulation.webots.ts`) | `NaoPythonGen`, `NaoPythonSimGen` | `SaveWorker` + `TransferWorker` | `TokenConnection` |
| `RobotNXT` | `nxt` | `nxt` | `nxc`/`rxe` | `old-S` | `robot.nxt.ts` (multisim) | `NxtCxxGen`, `NxtSim` | `NxtComp` (`nbc`) + `TransferWorker` | `TokenConnection` |
| `RobotRobotino` | `robotino`, `robotinoROS`* | `robotino` | `py`/`py` | `new` | `robot.robotino.ts` (multisim) | `Robotino*PythonGen`, `RobotinoSim` | `SaveWorker` (+ `TransferWorker` for `robotino`) | `TokenConnection` |
| `RobotSpike` | `spike` | `spike` | `py`/`py` | `new` | `robot.spike.ts` (multisim) | `SpikePythonGen`, `SpikeSim` | `SaveWorker` + `TransferWorker` | `TokenConnection` |
| `RobotSpike` | `spikePybricks` | `spike` | `py`/`py` | `new` | `robot.spike.ts` (multisim) | `SpikePybricksPythonGen`, `SpikeSim` | `SpikePybricksComp` (`compile.py` → `mpy-cross-v6`) | `SpikePybricksWebBleConnection` |
| `RobotSpike` | `rcj` | `rcj` | `json`/`json` | `new` | `robot.rcj.ts` (multisim) | `RCJSim` | None (sim-only) | `SimOnlyConnection` |
| `RobotThymio` | `thymio` | `thymio` | `aesl`/`aesl` | fixed | `robot.thymio.ts` (multisim) | `ThymioAsebaGen`, `ThymioSim` | `SaveWorker` | `ThymioDeviceManagerConnection` |
| `RobotWeDo` | `wedo` | `wedo` | `json`/`json` | `new` | No | `WedoCodeGen` | `WedoCodeGen` (client `Interpreter` + `RobotWeDoBehaviour`) | `WebViewConnection` |

---

## 5. Playbooks for Common Tasks

### A. Adding a New Robot Platform
1. **Maven**: Add to existing `Robot*` module, or create `Robot<Name>` and register in root `pom.xml` + `OpenRobertaServer/pom.xml`.
2. **Resources (`Robot<Name>/src/main/resources/`)**: Create `<robot>.properties` (group, extensions, workers, workflows), `<robot>.program.toolbox.{beginner,expert}.xml`, `<robot>.program.default.xml`, and `<robot>.configuration.{toolbox,default}.xml`.
3. **Java Visitors & Workers**: Implement `I<Robot>Visitor<V>`, `<Robot>ValidatorAndCollectorVisitor`, `<Robot>TypecheckVisitor`, `<Robot><Lang>Visitor`, `<Robot>StackMachineVisitor` (if sim), and worker classes in `worker/`.
4. **Whitelist**: Add `<robot>` to `robot.whitelist` in `OpenRobertaServer/src/main/resources/openRoberta.properties`.
5. **Frontend**: Add `<Robot>Connection` in `connections.ts`, board config in `configVisualization/robots.xml` (if `new` config), icon styles in `staticResources/app/scss/_robots.scss`, then run `npx --prefix OpenRobertaWeb gulp`.

### B. Adding / Modifying Simulation Support
1. **`<robot>.properties`**: Set `robot.plugin.sim = true`, configure `getsimulationcode` workflow and `validate.and.collect.sim` + `generatesimulation` workers.
2. **Backend**: Implement `<Robot>StackMachineVisitor` (extending `AbstractStackMachineVisitor`) using `C.java` opcodes; add unit tests in `Robot<Name>/src/test/java/`.
3. **Interpreter**: Match constants in `C.java`, `interpreter.constants.ts`, and `simulationLogic/constants.js`. Verify `getSample` and actuator state in `interpreter.robotSimBehaviour.ts`.
4. **Sim Classes (`simulationLogic/`)**: Create/update `robot.<group>.ts` (`configure(config)`), `robot.sensors.ts`, and `robot.actuators.ts`.
   - **New `robot.<name>.ts` files MUST be registered in BOTH** `OpenRobertaWeb/tsconfig.json` (`compilerOptions.paths`) **and** `OpenRobertaWeb/src/main.js` (`require.config.paths`).
5. **Build**: Run `npx --prefix OpenRobertaWeb gulp`.

### C. Adding / Modifying a Block, Sensor, or Actuator
1. Add block to toolbox XML (visual block definitions live in external `OpenRoberta/blockly` repo → `staticResources/blockly/`).
2. Map block name in `blockNames.properties` or `@NepoPhrase(blocklyNames = {...})` on the AST class in `de.fhg.iais.roberta.syntax.**`.
3. Add `visit<AstClass>` to visitor interface(s) and implement across `*ValidatorAndCollectorVisitor`, `*TypecheckVisitor`, `*<Lang>Visitor`, and `*StackMachineVisitor`.

---

## 6. Critical Gotchas & Pitfalls

1. **Never edit `OpenRobertaServer/staticResources/js/` or `css/` directly**: They are overwritten by Gulp. Edit `OpenRobertaWeb/src/` and `staticResources/app/scss/`, then run `npx --prefix OpenRobertaWeb gulp`.
2. **Always run `npx gulp` (not just `npm run build`)**: `npm run build` outputs unminified JS; production commits require `npx --prefix OpenRobertaWeb gulp` (`gulp-terser`).
3. **TypeScript `noImplicitOverride` is enabled**: Every overridden method in subclasses (`robot.*.ts`, `robot.sensors.ts`, `robot.actuators.ts`, `connections.ts`) **must** have the `override` keyword.
4. **Dual RequireJS/TS registration**: New frontend modules must be added to both `OpenRobertaWeb/tsconfig.json` and `OpenRobertaWeb/src/main.js` or the browser will 404 at runtime.
5. **Cross-module `@NepoConfiguration` scanning in unit tests**: `RobotFactory` scans the active classpath for `@NepoConfiguration`. Some config classes (e.g., `Colour.java` for `robConf_colour` in `RobotMbed`) are on `OpenRobertaServer`'s classpath at runtime, but **not** on another `Robot*` module's test classpath (`mvn test -pl RobotSpike`). Shared `@NepoConfiguration` classes must reside in `OpenRobertaRobot`.
6. **`.properties` `#include` directives**: Always check line 1 of `<robot>.properties` for `#include classpath:/...` where base workers/workflows are inherited.
