/** A well-formed workspace mutation that names an impossible relationship or list position. */
export class WorkspaceInputError extends Error {
    override readonly name = "WorkspaceInputError";
}
