---
layout: post
title: CQL3 to Astyanax Compatibility
author: Nate McCall
category: blog
tags: CQL3, astyanax, thrift, cassandra
---
### Overview
A lot of folks have been having [issues](http://mail-archives.apache.org/mod_mbox/cassandra-user/201308.mbox/%3CCAAtvD4Un26yBd8rAMqctjRN4YKtCuxEekhq8WOqj7XVMcjEU3Q%40mail.gmail.com%3E) [lately](http://mail-archives.apache.org/mod_mbox/cassandra-user/201309.mbox/%3C541C7781A689464891C05251C07E8CCF3D9D10AA9C@farseer.lithium.local%3E) with the performance of insert-heavy workloads via CQL. Though batch statements are available in the new 2.0 release, the general consensus in the community has been that switching back to the Thrift API is the most immediate and well understand path for alleviating mutation performance issues with CQL. 

Unfortunately, maintaining compatibility with CQL3 and Thrift schemas, though possible, is not a trivial effort. We'll describe here a method to make this interoperability more accessible. 

### Compatibility Example
There are a few resources floating around the internet already on how to do this in a general case (see the resources section below). However, this particular example is based on a common problem of wide row insertions for time series data. Specifically, when you define an index column along with the primary key definition, things get slightly more complicated when converting to Thrift for mutations. 

The rest of this article assumes you already have some knowledge of Astyanax and CQL3. 

Given the following table definition 

	CREATE TABLE timeseries_bucket (
  		id uuid,
  		start timestamp,
  		offset bigint,
  		score double,
  		temperature double,
  		PRIMARY KEY ((id, start), offset)
	);

We setup the serializers for the row key and time series column respectively:

	private final AnnotatedCompositeSerializer rowKeySerializer
          = new AnnotatedCompositeSerializer(TsRowKey.class);

    private final AnnotatedCompositeSerializer columnSerializer 
    	  = new AnnotatedCompositeSerializer(TimeSeriesColumn.class);
	
We use this mutation code:

	// setup up our column family and mutation
	ColumnFamily columnFamily 
	      = new ColumnFamily("timeseries_bucket", rowKeySerializer, columnSerializer);
	MutationBatch mutation = keyspace.prepareMutationBatch();

	// where id is a java.util.UUID and start is a java.util.Date
	TsRowKey rowKey = new TsRowKey(id, start);
	ColumnListMutation clm = mutation.withRow(columnFamily, rowKey);

	// the 'indexRow' is the tricky part: note the empty ByteBuffer value
	clm.putColumn(indexRow(currTimeOffset), ByteBufferUtil.EMPTY_BYTE_BUFFER, null)
	.putColumn(scoreColumn(currTimeOffset), score, null)
	.putColumn(tempColumn(currTimeOffset), temperature, null);
                                    
And the annotated classes representing the row key and the column:                  

    class TsRowKey {
        @Component(ordinal = 0)
        UUID id;
        @Component(ordinal = 1)
        long timestamp;

        TsRowKey(UUID id, Date date) {
            this.id = id;
            this.timestamp = date.getTime();
        }
    }

	/**
	 * Note the null value name for the index marker row
	 */
    static TimeSeriesColumn indexRow(long offset) {
        TimeSeriesColumn ts = new TimeSeriesColumn();
        ts.offset = offet;
        ts.valueName = null;  
        return ts;
    }

    static TimeSeriesColumn scoreColumn(long offset) {
        TimeSeriesColumn ts = new TimeSeriesColumn();
        ts.offset = offset;
        ts.valueName = "score";
        return ts;
    }
    
    static TimeSeriesColumn tempColumn(long offset) {
        TimeSeriesColumn ts = new TimeSeriesColumn();
        ts.offset = offset;
        ts.valueName = "temperature";
        return ts;
    }

    static class TimeSeriesColumn {
        @Component(ordinal = 0)
        long offset;
        @Component(ordinal = 1)
        String valueName;   
    }
    
The static indexRow method above is the critical part as it correlates to the way we structured our index clause back in the table definition: `PRIMARY KEY ((id, start), offset)`

With this insertion, thrift will see the following composites:

	=> (name=1000:, value=, timestamp=1378321501291000)
	=> (name=1000:score, value=40586ecf14f52e23, timestamp=1378321501291000)
	=> (name=1000:temperature, value=40586ecf14f52e23, timestamp=1378321501291000)

The first line being our index marker column from the indexRow method mentioned. Brian's post below has some more details on what's going on with the composites as seen by Thrift. 
    
### Additional Resources
A pair of posts from Brian O'Neil:

- [http://brianoneill.blogspot.com/2012/09/composite-keys-connecting-dots-between.html](http://brianoneill.blogspot.com/2012/09/composite-keys-connecting-dots-between.html)
- [http://brianoneill.blogspot.com/2012/10/cql-astyanax-and-compoundcomposite-keys.html](http://brianoneill.blogspot.com/2012/10/cql-astyanax-and-compoundcomposite-keys.html)

The Astyanax wiki:
[https://github.com/Netflix/astyanax/wiki/Cql-and-cql3](https://github.com/Netflix/astyanax/wiki/Cql-and-cql3)


And [this post](http://mail-archives.apache.org/mod_mbox/cassandra-user/201309.mbox/%3C541C7781A689464891C05251C07E8CCF3D9D29D57B%40farseer.lithium.local%3E) from a recent mail list thread about insert performance of CQL3.

### (Edit)
After a brief off list chat with [Paul Cichonski](https://github.com/paulcichonski), author of the reply above, I'm including the code example here because it's a good complement to the time series one we have already.

The CQL table definition:

	CREATE TABLE standard_subscription_index
	(
 		subscription_type text,
		subscription_target_id text,
		entitytype text,
		entityid int,
		creationtimestamp timestamp,
		indexed_tenant_id uuid,
		deleted boolean,
    	PRIMARY KEY ((subscription_type, subscription_target_id), entitytype, entityid)
	)

Astyanax ColumnFamily object definition (a little difficult to read, but the typing is left in for completeness):

	private static final ColumnFamily<SubscriptionIndexCompositeKey, SubscribingEntityCompositeColumn>
	COMPOSITE_ROW_COLUMN 
		= new ColumnFamily<SubscriptionIndexCompositeKey, 	SubscribingEntityCompositeColumn>(
	SUBSCRIPTION_CF_NAME, 
	new AnnotatedCompositeSerializer<SubscriptionIndexCompositeKey>(SubscriptionIndexCompositeKey.class),
	new AnnotatedCompositeSerializer<SubscribingEntityCompositeColumn>(SubscribingEntityCompositeColumn.class));

Description from Paul: 

> SubscriptionIndexCompositeKey is a class that contains the fields from the row key (e.g., subscription_type, subscription_target_id), and SubscribingEntityCompositeColumn contains the fields from the composite column (as it would look if you view your data using Cassandra-cli), so: entityType, entityId, columnName. The columnName field is the tricky part as it defines what to interpret the column value as (i.e., if it is a value for the creationtimestamp the column might be "someEntityType:4:creationtimestamp" 
>
> The actual mutation looks something like this:

	final MutationBatch mutation = getKeyspace().prepareMutationBatch();
	final ColumnListMutation<SubscribingEntityCompositeColumn> row = 	mutation.withRow(COMPOSITE_ROW_COLUMN,
		new SubscriptionIndexCompositeKey(targetEntityType.getName(), targetEntityId));

	for (Subscription sub : subs) {
		row.putColumn(new SubscribingEntityCompositeColumn(sub.getEntityType().getName(), sub.getEntityId(),
				"creationtimestamp"), sub.getCreationTimestamp());
	row.putColumn(new SubscribingEntityCompositeColumn(sub.getEntityType().getName(), sub.getEntityId(),
				"deleted"), sub.isDeleted());
	row.putColumn(new SubscribingEntityCompositeColumn(sub.getEntityType().getName(), sub.getEntityId(),
				"indexed_tenant_id"), tenantId);
	}
	
Hopefully between the two examples (thanks again to Paul for the completeness), and the Astyanax documentation [on composite annotations](https://github.com/Netflix/astyanax/wiki/Composite-columns), you should have a good starting point to convert your CQL3 insertions to Thrift mutations. 


