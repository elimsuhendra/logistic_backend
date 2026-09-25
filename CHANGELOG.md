# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.3] - 2026-09-25 - Automated Job Planning Numbering and Streamlined Activity History

### Added

- **Automatic Job Planning Numbering**: Enabled the system to retrieve the latest job planning record for an account and month, allowing new planning entries to automatically receive the next sequential reference number without manual numbering errors.

### Changed

- **Streamlined Activity History Details**: Simplified the activity log format to ensure system audit trails and change history records remain clear, consistent, and easy to review across all actions.


## [1.3.2] - 2026-09-23 - Comprehensive Activity History and Performance Improvements

### Added

- **Automatic Activity Tracking**: Every time records such as companies, candidates, job orders, and users are created, updated, or removed, the system now automatically records an activity history entry, making it easy to see who performed an action and when it occurred.
- **Change Details and Historical Comparison**: Activity records now capture submitted changes alongside prior details, providing a transparent audit trail for administrative review.

### Changed

- **Standardized Activity Timelines**: Unified activity logging across all sections of the application so history timelines display reliably and consistently.
- **Faster Data Retrieval**: Optimized list counts and search results to ensure summary statistics and pagination load smoothly without system delays.

### Fixed

- **Reliable User Management Actions**: Resolved an issue where saving edits to user details or removing accounts could stall, ensuring user management operations finish immediately and accurately.


## [1.3.1] - 2026-09-22 - Account Association and User Profile Details

### Added

- **Account Association for Users**: User accounts can now be linked directly to specific organization accounts, displaying associated account names and code initials.
- **Employee ID Support**: Users can now have unique employee identification numbers assigned and updated during registration and user management.
- **Contact Details Management**: Enhanced profile updates to support maintaining up-to-date mobile phone numbers and email contact information.

### Changed

- **Smooth Profile Saving**: Improved user and profile update handling to ensure save operations complete seamlessly without unexpected warning messages when details are saved.

## [1.3.0] - 2026-09-17 - Job Planning Details Streamlining

### Changed

- **Simplified Job Planning Records**: Streamlined job planning information by removing creator assignment tracking to simplify entry and management of planning records.


## [1.2.0] - 2026-09-16 - Company Status Management and Asset Storage Updates

### Added

- **Company Active and Inactive Status**: Added support for designating companies as active or inactive when creating and updating company records, making it easier to manage client accounts and maintain clean company directories.
- **Status-Based Company Filtering**: Enabled filtering company records by active or inactive status so users can quickly locate and organize their accounts.

### Changed

- **Optimized Upload Storage Structure**: Organized server file storage for uploaded media assets and documents, ensuring secure and consistent handling of customer and company files.


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
