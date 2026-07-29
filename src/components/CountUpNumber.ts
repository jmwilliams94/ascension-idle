import RawCountUp from 'react-countup'

// react-countup ships CJS-only (package.json has no "module"/"exports" field,
// just `main: "build"`) and sets its export via `exports.default = CountUp`
// rather than `module.exports = CountUp`. Both Vite's esbuild dev-dependency
// pre-bundler and its Rollup-based production bundler resolve a plain default
// import of this shape to the *whole* CJS exports object (`{ default: CountUpFn,
// useCountUp }`), not the unwrapped function — causing React error #130
// ("expected a class/function but got: object") wherever <CountUp/> is
// rendered, in both `npm run dev` and the deployed production build alike.
// This one-line defensive unwrap works regardless of which shape a given
// bundler/version actually produces. Import this instead of 'react-countup'
// directly everywhere in the app.
const CountUp = (RawCountUp as unknown as { default?: typeof RawCountUp }).default ?? RawCountUp

export default CountUp
