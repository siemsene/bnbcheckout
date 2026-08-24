# rules-tests

Standalone workspace for testing `../firestore.rules` with
`@firebase/rules-unit-testing` + vitest. Kept separate so the app's root
`package.json` stays untouched.

## Running

The tests need the Firestore emulator (which requires a Java runtime, JDK 11+).
From this directory:

```sh
npm install
npx firebase emulators:exec --only firestore --project demo-checkout "npx vitest run"
```

(`npm test` runs the same command.)

If the emulator is already running on `localhost:8080`, you can run
`npx vitest run` directly — the tests pick up `FIRESTORE_EMULATOR_HOST`
or fall back to `localhost:8080`.
