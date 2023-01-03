// Import our outputted wasm ES6 module
// Which, export default's, an initialization function
import init from "./wasm_game_of_life.js";

const runWasm = async () => {
    // Instantiate our wasm module
    const helloWorld = await init("./wasm_game_of_life_bg.wasm");

    // Call the Add function export from wasm, save the result
    const addResult = helloWorld.greet("ddd");

    // Set the result onto the body
    document.body.textContent = `Hello World! addResult: ${addResult}`;
};
runWasm();