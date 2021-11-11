echo "zipping functions..."
zip -r cancelImport.zip functions/cancelImport/*
zip -r createAndIdMaterial.zip functions/createAndId_material/*
zip -r importJobStatus.zip functions/importJobStatus/*
zip -r orderExport.zip functions/orderExport/*
zip -r parseXMLFromS3.zip functions/parseXMLFromS3/*
zip -r processAPIAssets.zip functions/process_API_assets/*
zip -r processAPIItems.zip functions/process_API_Items/*
zip -r processAPIItemsError.zip functions/process_API_Items_Error/*
echo "done zipping functions, sending to S3..."
aws s3 cp cancelImport.zip s3://${S3_BUCKET}/
aws s3 cp createAndIdMaterial.zip s3://${S3_BUCKET}/
aws s3 cp importJobStatus.zip s3://${S3_BUCKET}/
aws s3 cp orderExport.zip s3://${S3_BUCKET}/
aws s3 cp parseXMLFromS3.zip s3://${S3_BUCKET}/
aws s3 cp processAPIAssets.zip s3://${S3_BUCKET}/
aws s3 cp processAPIItems.zip s3://${S3_BUCKET}/
aws s3 cp processAPIItemsError.zip s3://${S3_BUCKET}/
echo "done sending to S3."