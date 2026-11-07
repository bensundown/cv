-- Duplicate resolution: an inventory record that is the same physical equipment as another record.
-- The duplicate keeps its source data and history but is excluded from design stock.
ALTER TABLE inventory_item
  ADD COLUMN duplicate_of uuid REFERENCES inventory_item(id),
  ADD COLUMN duplicate_note text,
  ADD COLUMN duplicate_marked_by uuid REFERENCES app_user(id),
  ADD COLUMN duplicate_marked_at timestamptz,
  ADD CONSTRAINT inventory_item_not_self_duplicate CHECK (duplicate_of IS NULL OR duplicate_of <> id);
