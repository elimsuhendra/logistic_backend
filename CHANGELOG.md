# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [1.1.0] - 2026-09-14 - Media Storage and Cross-Platform Reliability

### Added

- **Direct Photo and Logo Storage**: Profile pictures and company logos can now be uploaded and stored directly on the server, ensuring they display reliably and load faster across the application.

### Fixed

- **System Startup and Preparation Compatibility**: Resolved an issue where preparing and building the application failed on Windows, ensuring smooth and reliable operation across all supported platforms.


## [1.0.0] - 2026-06-03 - Initial backend repository setup

### Added

- **Initial Server Launch**: Launched the baseline version of the Global Expressindo backend server API.
- **Data and Job Processing**: Configured the database connection and background task queues for reliable, real-time message and check-in processing.
- **Real-time Subscriptions**: Implemented live updates support via WebSockets.
