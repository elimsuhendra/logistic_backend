# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [1.3.13] - 2026-11-25 - Status Operation Check and Approval Turns

### Added

- **Status Operation Check**: Added `updateStatusOperation(cashRequestIds)`. For each cash request sent, if its approval status is Approved and it was approved before today (the last-updated time of its active Approved approval), its Status Operation is set from the last digit of its first job's Job Planning No.: 1 or 8 becomes Due 3 Days, 2 or 9 becomes Due 5 Days. Draft, Cancel and Finish cash requests are not changed. The result says how many cash requests were updated.
- **Approval Attempt**: Each approval stores an attempt number. Approvals created together for the same record share one attempt, which is one higher than that record's previous attempt (starting at 1).
- **Current Turn**: Each approval stores whether it is the current turn (`isCurrentTurn`), meaning the approver who should act now: the first active Pending approval in approval order. It is kept up to date whenever approvals are created, updated or removed, and approvals can be filtered by it.
- **Data Update Command**: Added `yarn db:migrate:approvalCurrentTurn`, a one-time command that sets the current turn on existing approvals. It can be run again safely.

### Changed

- **Approve Passes to the Next Approver**: When an approver chooses Approve, the next approver in the approval order becomes Pending and it becomes their turn, unless they have already decided. The last approver chooses Approved.


## [1.3.12] - 2026-11-24 - Cash Request Settlements, Approval Revision and Approval Order

### Added

- **Cash Request Settlement Details**: A cash request settlement now records its rounding, the total after rounding, who created it, whether it was saved as a draft, and its latest approval status. Settlements can be searched by settlement number or cash request number, filtered by creator or draft status, and sorted by settlement number, for the new Cash Request Settlements page.
- **Approval Order**: Each approval now stores its position in the approval order (first approver, second approver, and so on), and approvals can be listed in that order.
- **Data Update Commands**: Added two one-time commands to run after this update: `yarn db:migrate:cashRequestNo` moves the cash request number of existing cash requests to the new field name, and `yarn db:migrate:approvalRevision` changes approvals saved as Cancelled to Revision. Both can be run again safely. Until they are run, older records are still read correctly.

### Changed

- **Cash Request Number Renamed**: The cash request number is now called `cashRequestNo` instead of `cashNo` in the API, including searching, sorting and getting the latest number (`getLastCashRequest(prefixCashRequestNo)`). Settlements keep their own `cashNo` copy of the number.
- **Cancelled Approval Status Renamed to Revision**: The approval status Cancelled is now Revision, meaning the approver sent the request back to be revised.
- **Updating One Approval at a Time**: `updateApproval` now takes the approval's own id and updates only that approval with the fields sent, setting its last-updated time. It no longer replaces all approvals of a record. Clients must send `updateApproval(id, input)` instead of `updateApproval(reffId, input: [...])`.


## [1.3.11] - 2026-11-17 - Voucher Accounts and Automatic Voucher Numbers

### Added

- **Voucher Accounts**: Added a list of payment accounts (such as Kas BCA Aya, Uang Cash Aya, Kasbonan Supir, and Kasbonan Operasional) that can be chosen when recording a voucher. Accounts can be shared by every business account or belong to a single one, and inactive accounts are hidden from the choices.
- **Voucher Account Setup Script**: Added a setup command (`yarn db:seed:categories`) that loads the standard voucher accounts on its own, without touching any other data. Running it again updates the existing accounts instead of creating duplicates.
- **Automatic Voucher Numbers**: Voucher numbers are now generated automatically in the format `[account initial]/VKK-K/[year][month]/[0001]`, for example `PJT/VKK-K/2611/0001`. The number continues from the last voucher of the same business account and starts again from 0001 at the beginning of each month, based on Indonesian time (WIB).


## [1.3.10] - 2026-11-17 - Separate Settlement Records for Cash Requests

### Changed

- **Settlements Stored Separately**: Settlements (Penyelesaian) of a cash request are now kept as their own records, one for each type: Driver, Lolo, Job, Spare Part, and Other. Each record holds the rows of its settlement table and its own total, so settlements can be saved and reviewed without changing the cash request itself.

### Added

- **Settlement Data Move**: Added a one-time command (`yarn db:migrate:settlements`) that moves the settlement totals and Penyelesaian Supir / Lolo rows already saved on cash requests into the new settlement records. Running it again does not create duplicates.


## [1.3.9] - 2026-11-16 - Cash Requests with Approvals

### Added

- **Cash Requests**: Added support for creating, viewing, updating, and removing cash requests, including removing several at once. Each request has a type (PJ, SP, or KG), a request date, and one row per job with its quantity, area, and amount, plus other, spare part, and rounding amounts and the request total.
- **Automatic Bond Numbers**: The bond number (Cash No.) continues from the last request with the same business account, type, and month.
- **Driver and Lolo Settlements**: Cash requests can record Penyelesaian Supir (vehicle, driver, departure and transfer dates, cash advance, additional costs, and the difference from the advance) and Penyelesaian Lolo (AJU, container number, repair and admin fees, rounding, and total cost).
- **Cash Request Approvals**: Added approvals for cash requests. Each approver's decision is recorded as Waiting, Pending, Approved, Rejected, or Cancelled, together with a note.
- **Employee Setup Script**: Added a setup command (`yarn db:seed:employees`) that loads the standard employee records.

### Changed

- **Cash Request Access**: Users now only see the cash requests of their business account that they created or are asked to approve.


## [1.3.8] - 2026-11-02 - Account Contact Numbers and One Login for Many Accounts

### Added

- **Business Account Contact Number**: Business accounts can now store a contact number, and the list of accounts can be searched by it.
- **One Login for Many Accounts**: A single user login can now belong to several business accounts, with a separate employee record for each one (employee ID, work email, phone, and role). Users can switch between their accounts without signing in again.


## [1.3.7] - 2026-10-26 - Role Management with Menu Access Control

### Added

- **Role Management**: Added support for creating, viewing, updating, and removing roles, including a role name, short code, description, linked business accounts, and active status.
- **Menu Access per Role**: Each role can now store which menus it can open and whether it is allowed to view, create, update, or delete within each menu.


## [1.3.6] - 2026-10-23 - Business Account Administration and User Assignment

### Added

- **Business Account Management**: Added support for creating, viewing, updating, and removing business accounts, including company initials, contact email, status, and assigned team members.

## [1.3.5] - 2026-10-12 - More Reliable File and Photo Uploads

### Fixed

- **Reliable Photo and File Uploads**: Uploaded photos and documents are now stored safely in cloud storage, so they remain available after system updates and can be opened from any device.
- **Exported Reports**: Excel reports are now saved to cloud storage using the same improved upload method for more dependable downloads.

### Changed

- **Unique File Names**: Every uploaded file now receives its own unique name, so a new upload never replaces an older file with the same name.


## [1.3.4] - 2026-10-01 - Fleet Vehicle Management and Plate Verification

### Added

- **Fleet Vehicle Management**: Added complete support for storing and managing vehicle records including license plates, registration documents, vehicle dimensions, capacities, and active operational status.
- **License Plate Verification**: Introduced real-time checking to confirm whether a license plate number is already registered or available for use, preventing accidental duplicate vehicle entries across the fleet.


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
