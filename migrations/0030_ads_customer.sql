-- The Google Ads account the owner chose for a site, as "customer" or "manager/customer"; NULL uses the only account the connection can see.
ALTER TABLE sites ADD COLUMN ads_customer TEXT;
