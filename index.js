#!/usr/bin/env node

var METRIC_COLLECTOR = process.env.METRIC_COLLECTOR ? process.env.METRIC_COLLECTOR : 'http://localhost:8086/hyperflow_tests';
var INTERFACE = process.env.INTERFACE ? process.env.INTERFACE : 'eth0';

var DISK_DEVICE = process.env.DISK_DEVICE ? process.env.DISK_DEVICE : 'xvda1';

var os = require('os');
const si = require('systeminformation');

var os_utils = require('os-utils');
var AWS = require('aws-sdk');
const Influx = require('influxdb-nodejs');
var express = require('express');
var prometheus = require('prom-client');

var diskStat = require('disk-stat');

var meta  = new AWS.MetadataService();

var prometheusMetrics = {};

prometheus.collectDefaultMetrics();

function writeDataToDatabase(metric, data,tag)
{
    //console.log("json %s %j",metric,data);
    const client = new Influx(METRIC_COLLECTOR);

    // data["wfid"] = that.getWfId();
    // data["hfId"] = that.getHfId();

    client.write(metric)
    .field(data)
    .tag(tag)
    .then(() => true)
    .catch(console.error);
}

function collectUsage(instance_id)
{
    os_utils.cpuUsage(function(v){
        //console.log( 'CPU Usage (%): ' + v );
        writeDataToDatabase("hyperflow_cpu_usage_ec2",{ cpu_usage:v},{ec2_incance_id: instance_id});

        prometheusMetrics.hyperflow_cpu_usage_ec2 = prometheusMetrics.hyperflow_cpu_usage_ec2 ||
            new prometheus.Gauge({
                name: 'hyperflow_cpu_usage_ec2',
                help: 'CPU usage',
                labelNames: ['ec2_instance_id']
            });
        prometheusMetrics.hyperflow_cpu_usage_ec2.set({ec2_instance_id: instance_id}, v);
    });

    si.mem(function(data) {
        //console.log('Memory used:');
        var used_memory=data.used/1024;
        //console.log(data.used/1024);
        writeDataToDatabase("hyperflow_memory_usage_ec2",{ used_memory:used_memory},{ec2_incance_id: instance_id});
        prometheusMetrics.hyperflow_memory_usage_ec2 = prometheusMetrics.hyperflow_memory_usage_ec2 ||
            new prometheus.Gauge({
                name: 'hyperflow_memory_usage_ec2',
                help: 'Memory usage',
                labelNames: ['ec2_instance_id']
            });
        prometheusMetrics.hyperflow_memory_usage_ec2.set({ec2_instance_id: instance_id}, used_memory);
    });

    si.networkStats(INTERFACE,function(data){
        //console.log('eth0 used:');
        console.log(data);
        if(data.rx_sec!=-1)
        {
            writeDataToDatabase("hyperflow_connection_received",{ received_bytes_per_s:data.rx_sec},{ec2_incance_id: instance_id});
            writeDataToDatabase("hyperflow_connection_transferred",{ transferred_bytes_per_s:data.tx_sec},{ec2_incance_id: instance_id});

            prometheusMetrics.hyperflow_connection_received = prometheusMetrics.hyperflow_connection_received ||
                new prometheus.Gauge({
                    name: 'hyperflow_connection_received',
                    help: 'Received bytes per second',
                    labelNames: ['ec2_instance_id']
                });
            prometheusMetrics.hyperflow_connection_received.set({ec2_instance_id: instance_id}, data.rx_sec);

            prometheusMetrics.hyperflow_connection_transferred = prometheusMetrics.hyperflow_connection_transferred ||
                new prometheus.Gauge({
                    name: 'hyperflow_connection_transferred',
                    help: 'Transferred bytes per second',
                    labelNames: ['ec2_instance_id']
                });
            prometheusMetrics.hyperflow_connection_transferred.set({ec2_instance_id: instance_id}, data.tx_sec);
        }
    });


    diskStat.usageRead({
        device: DISK_DEVICE,
        units: 'KiB',
      },
      function(kbPerSecond) {
        console.log(kbPerSecond);
        writeDataToDatabase("hyperflow_disc_read",{ read_bytes_per_s:kbPerSecond},{ec2_incance_id: instance_id});

        prometheusMetrics.hyperflow_disc_read = prometheusMetrics.hyperflow_disc_read ||
            new prometheus.Gauge({
                name: 'hyperflow_disc_read',
                help: 'Read kB per second',
                labelNames: ['ec2_instance_id']
            });
        prometheusMetrics.hyperflow_disc_read.set({ec2_instance_id: instance_id}, kbPerSecond);
    });

    diskStat.usageWrite({
        device: DISK_DEVICE,
        units: 'KiB',
      },
      function(kbPerSecond) {
        console.log(kbPerSecond);
        writeDataToDatabase("hyperflow_disc_write",{ write_bytes_per_s:kbPerSecond},{ec2_incance_id: instance_id});

        prometheusMetrics.hyperflow_disc_write = prometheusMetrics.hyperflow_disc_write ||
            new prometheus.Gauge({
                name: 'hyperflow_disc_write',
                help: 'Write kB per second',
                labelNames: ['ec2_instance_id']
            });
        prometheusMetrics.hyperflow_disc_write.set({ec2_instance_id: instance_id}, kbPerSecond);
    });
}


meta.request("/latest/meta-data/instance-id", function(err, data){
    var instance_id = "undef" ;
    if(err)
    {
        console.log("err");
    }else
    {
        console.log(data);
        instance_id = data;
    }
        
    setInterval(function () {
        collectUsage(instance_id);
    }, 1000);
});

var app = express();

app.get('/metrics', (req, res) => {
    res.set('Content-Type', prometheus.register.contentType);
    res.send(prometheus.register.metrics());
});

app.listen(3001, () => console.log(`Example app listening on port 3001!`))
