# Environment variable changelog
Any changes to the environment variables will be documented in this file in chronological
order with the most recent changes first.

## 2022-11-04
### Added
- MAX_BATCH_INPUTS - Upper limit on the number of files that can go into an aggregation batch
- MAX_BATCH_SIZE_IN_BYTES - Upper limit on the total number of bytes in all the files going into an aggregation batch

## 2022-06-03
### Added
- MAX_PUT_WORK_RETRIES - how many times a manager should retry a retryable PUT /work request

## 2022-06-01
### Added
- MAX_DOWNLOAD_RETRIES - Number of times to retry failed HTTP (408, 502, 503, 504) data downloads in the the service library.

## 2022-03-07
### Changed
- ASF_GDAL_SUBSETTER_IMAGE to HARMONY_GDAL_ADAPTER_IMAGE

## 2020-12-02
### Added
- CMR_MAX_PAGE_SIZE - page_size parameter to use for CMR requests
## 2020-11-20
### Added
- CMR_GRANULE_LOCATOR_IMAGE - New image for issuing queries to the CMR to identify granules for a request
- CMR_GRANULE_LOCATOR_IMAGE_PULL_POLICY - Pull policy for the new granule locator image

### Changed
- ASF_GDAL_IMAGE to ASF_GDAL_SUBSETTER_IMAGE
- ASF_GDAL_IMAGE_PULL_POLICY to ASF_GDAL_SUBSETTER_IMAGE_PULL_POLICY
- ASF_GDAL_PARALLELLISM to ASF_GDAL_SUBSETTER_PARALLELISM
- GDAL_IMAGE to HARMONY_GDAL_IMAGE
- GDAL_IMAGE_PULL_POLICY to HARMONY_GDAL_IMAGE_PULL_POLICY
- GDAL_PARALLELLISM to HARMONY_GDAL_PARALLELISM
- NETCDF_TO_ZARR_IMAGE to HARMONY_NETCDF_TO_ZARR_IMAGE
- NETCDF_TO_ZARR_IMAGE_PULL_POLICY to HARMONY_NETCDF_TO_ZARR_IMAGE_PULL_POLICY
- NETCDF_TO_ZARR_PARALLELLISM to HARMONY_NETCDF_TO_ZARR_PARALLELISM
- SWOT_REPR_IMAGE to SWOT_REPROJECT_IMAGE
- SWOT_REPR_IMAGE_PULL_POLICY to SWOT_REPROJECT_IMAGE_PULL_POLICY
- SWOT_REPR_PARALLELLISM to SWOT_REPROJECT_PARALLELISM

## 2022-01-19

### Removed
- All environment variable configuration related to Argo (ARGO_URL, IMAGE_PULL_POLICY vars, PARALLELISM vars)

### Changed
- DEFAULT_ARGO_TIMEOUT_SECS to DEFAULT_POD_GRACE_PERIOD_SECS