/** Public surface of the Titles module. */

export * from "./Title.js";
export * from "./TitlesModule.js";
export {
    createNamingRequest,
    createRefinementRequest,
    wantedNames,
    type NamingRequestText,
} from "./impl/createNamingRequest.js";
export { parseSuggestedNames } from "./impl/parseSuggestedNames.js";
export { selectNamingRoute, type NamingRoute } from "./impl/selectNamingRoute.js";
