# Contributing to NetPaceX

Thank you for your interest in contributing to NetPaceX! NetPaceX is a lightweight network speed testing application optimized for home servers, designed to measure both LAN and WAN speeds.

## Language Requirement
**IMPORTANT:** All contributions must be in **English**. This applies to:
* Issues and Pull Requests
* Commit messages
* Code variables, functions, and struct names
* Code comments and documentation

## How to Contribute
1. Fork the repository.
2. Create a feature branch (`git checkout -b feature/amazing-feature`).
3. Commit your changes. 

## Commit Message Conventions
Each commit message should follow this structure:

`<Prefix>: <Description>`

### Prefixes
Please use one of the following prefixes based on the nature of your change:

* **Fixed:** For bug fixes.
* **New:** For new features or additions.
* **Deleted:** For removing features or parts of the application.
* **Maintenance:** For non-bug fixes, refactoring, or general maintenance.
* **Others:** If none of the above apply, use a suitable prefix that clearly describes the change.

### Formatting Rules
* **Prefix:** Start with the appropriate prefix followed by a colon and a space.
* **Description:** Use Sentence case for the description (e.g., "Add new user profile section" instead of "add new user profile section" or "Add New User Profile Section").
* **Conciseness:** Keep the description brief but informative.

### Examples
* `Fixed: Resolve issue with BMI chart rendering on PDF`
* `New: Add Indonesian language support`
* `Deleted: Remove legacy authentication module`
* `Maintenance: Update dependencies to latest versions`

4. Push to the branch (`git push origin feature/amazing-feature`).
5. Open a Pull Request.
## Development Setup
NetPaceX consists of a Go backend and a Vanilla JS frontend.
1. `go run .` to start the backend during development.
2. The UI is served statically by the backend. modifying files in the `static/` directory will require a page refresh in the browser.

## Bug Reports and Feature Requests
Please use the GitHub Issue tracker to report bugs or suggest features. Be as descriptive as possible and provide steps to reproduce bugs.
