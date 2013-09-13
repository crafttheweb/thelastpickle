---
layout: post
title: CQL3 to Asytanax Compatibility
author: Nate McCall
category: blog
tags: CQL3, astyanax, thrift
---

A lot of folks have been having [issues](http://mail-archives.apache.org/mod_mbox/cassandra-user/201308.mbox/%3CCAAtvD4Un26yBd8rAMqctjRN4YKtCuxEekhq8WOqj7XVMcjEU3Q%40mail.gmail.com%3E) [lately](http://mail-archives.apache.org/mod_mbox/cassandra-user/201309.mbox/%3C541C7781A689464891C05251C07E8CCF3D9D10AA9C@farseer.lithium.local%3E) with the performance of insert-heavy workloads via CQL. Though batch statements are available in the new 2.0 release, we'll describe here a method to make interoperability between Thrift and CQL3 schema more accessible. 

There are a few resources floating around the internet already on how to do this in a general case (see the resources section below). However, this particular case is based on a common problem of wide row insertions for time series data. Specifically, when you define an index column along with the primary key definition, things get slightly more complicated. 

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

We setup the serializers fro the row key and time series column respectively:

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

	// the 'indexRow' is the tricky part
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
        TimeSeriesRow ts = new TimeSeriesRow();
        ts.offset = offet;
        ts.valueName = null;  
        return ts;
    }

    static TimeSeriesColumn scoreColumn(long offset) {
        TimeSeriesRow ts = new TimeSeriesRow();
        ts.offset = offset;
        ts.valueName = "score";
        return ts;
    }
    
    static TimeSeriesColumn tempColumn(long offset) {
        TimeSeriesRow ts = new TimeSeriesRow();
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

The first line being our index marker column from the indexRow method mentioned. Brian's post below has some more details on what's going on in the general case. 
    
### Additional Resources
A pair of posts from Brian O'Neil:

- [http://brianoneill.blogspot.com/2012/09/composite-keys-connecting-dots-between.html](http://brianoneill.blogspot.com/2012/09/composite-keys-connecting-dots-between.html)
- [http://brianoneill.blogspot.com/2012/10/cql-astyanax-and-compoundcomposite-keys.html](http://brianoneill.blogspot.com/2012/10/cql-astyanax-and-compoundcomposite-keys.html)

The Astyanax wiki:
[https://github.com/Netflix/astyanax/wiki/Cql-and-cql3](https://github.com/Netflix/astyanax/wiki/Cql-and-cql3)


And [this post](http://mail-archives.apache.org/mod_mbox/cassandra-user/201309.mbox/%3C541C7781A689464891C05251C07E8CCF3D9D29D57B%40farseer.lithium.local%3E) from a recent mail list thread about insert performance of CQL3.

