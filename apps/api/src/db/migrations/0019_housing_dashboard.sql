-- Drop the address-tracking subsystem. The agency only needs a real-time
-- count of who's on agency housing vs own housing — derivable from
-- candidates.status + candidates.housing_type. Concrete addresses, rooms,
-- coordinator placement history and capacity tracking are no longer in scope.
--
-- Order matters: placements has a FK on accommodations.
DROP TABLE IF EXISTS placements;
DROP TABLE IF EXISTS accommodations;
