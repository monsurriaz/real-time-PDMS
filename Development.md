# Development Guide

This document provides a quick reference for developers working on the Real-Time PDMS project.

## Project Structure

The project is organized into separate sections for the frontend, backend, shared resources, and development utilities.

### `client/`

Contains the frontend application and user interface components.

### `server/`

Contains the backend application, API logic, server configuration, and related services.

### `shared/`

Contains resources shared between the client and server, such as common types, schemas, and data definitions.

### `scripts/`

Contains utility scripts used for development, database setup, seeding, or other project-related tasks.

## Getting Started

### 1. Install Dependencies

After cloning the repository, install the project dependencies:

```bash
npm install
```

### 2. Configure Environment Variables

Check the `.env.example` file for the environment variables required by the project.

Create a local environment configuration file and provide the appropriate values for your development environment.

> Do not commit passwords, API keys, database credentials, or other sensitive information to the repository.

### 3. Start Development

Use the development scripts defined in `package.json` to start the application.

Before starting the project, make sure that all required environment variables and external services are properly configured.

## Development Workflow

A recommended workflow for making changes is:

1. Pull the latest changes from the main branch.
2. Create a separate branch for your work.
3. Make the required changes.
4. Test the changes locally.
5. Review the files modified by your changes.
6. Commit the changes with a descriptive commit message.
7. Push the branch to the remote repository.
8. Open a pull request when the changes are ready for review.

## Code Quality

When contributing to the project:

* Keep changes focused on the intended task.
* Follow the existing project structure and coding conventions.
* Avoid unnecessary changes to unrelated files.
* Use meaningful names for variables, functions, components, and files.
* Keep shared types and schemas consistent between the frontend and backend.
* Remove temporary debugging code before committing.

## Testing and Verification

Before submitting a change, verify that:

* The application starts successfully.
* The modified functionality works as expected.
* No sensitive information has been added to tracked files.
* There are no unintended changes in unrelated parts of the project.
* Relevant tests, type checks, or build checks pass when available.

## Git Commit Guidelines

Use concise and descriptive commit messages.

Examples:

```text
docs: update development guide
feat: add user authentication
fix: resolve login validation issue
refactor: simplify API response handling
chore: update project configuration
```

Keep each commit focused on a single logical change whenever possible.

## Security

Never commit sensitive configuration or credentials to the repository.

Examples of information that should remain private include:

* Database passwords
* API keys
* Authentication secrets
* Private tokens
* Personal credentials

Use environment variables for sensitive configuration whenever possible.

## Contribution Guidelines

Before pushing changes, review the final diff and make sure that only the intended files have been modified.

Small, focused commits make the project history easier to understand and maintain.
